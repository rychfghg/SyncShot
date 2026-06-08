import { useRef, useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import "./App.css";

const CAPTURE_WIDTH = 540;
const CAPTURE_HEIGHT = 960;
const IMAGE_QUALITY = 0.76;

function timeToSeconds(t) {
  const [h, m, rest] = t.replace(",", ".").split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(rest);
}

function formatVideoTime(seconds = 0) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canvasToJpeg(canvas, quality = IMAGE_QUALITY) {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

function drawContain(ctx, video, x, y, w, h) {
  const videoRatio = video.videoWidth / video.videoHeight;
  const areaRatio = w / h;

  let drawW = w;
  let drawH = h;

  if (videoRatio > areaRatio) {
    drawW = w;
    drawH = w / videoRatio;
  } else {
    drawH = h;
    drawW = h * videoRatio;
  }

  const drawX = x + (w - drawW) / 2;
  const drawY = y + (h - drawH) / 2;

  ctx.drawImage(video, drawX, drawY, drawW, drawH);
}

function parseSRT(srt) {
  if (!srt.trim()) return [];

  return srt
    .trim()
    .split(/\n\s*\n/)
    .map((block, index) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      const timeLine = lines.find((l) => l.includes("-->"));
      if (!timeLine) return null;

      const [start, end] = timeLine.split("-->").map((x) => x.trim());
      const startSeconds = timeToSeconds(start);
      const endSeconds = timeToSeconds(end);
      const middleSeconds = (startSeconds + endSeconds) / 2;

      return {
        id: index + 1,
        timecode: `${start} → ${end}`,
        startSeconds,
        endSeconds,
        middleSeconds,
        subtitle: lines.slice(lines.indexOf(timeLine) + 1).join(" "),
        comment: "",
        screenshot: "",
      };
    })
    .filter(Boolean);
}

function waitForSeek(video, time) {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };

    video.addEventListener("seeked", done, { once: true });
    video.currentTime = time;
  });
}

export default function App() {
  const videoRef = useRef(null);

  const [videoURL, setVideoURL] = useState("");
  const [videoName, setVideoName] = useState("");
  const [srtText, setSrtText] = useState("");
  const [rows, setRows] = useState([]);
  const [capturing, setCapturing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState("");

  function loadVideo(e) {
    const file = e.target.files[0];

    if (file) {
      setVideoURL(URL.createObjectURL(file));
      setVideoName(file.name);
    }
  }

  function syncSRT() {
    setRows(parseSRT(srtText));
  }

  async function captureScreenshot(row, shouldUpdateState = true) {
    const video = videoRef.current;
    if (!video) return "";

    await waitForSeek(video, row.middleSeconds);

    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;

    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const topBarH = 34;
    const playerH = 170;
    const videoAreaY = topBarH;
    const videoAreaH = CAPTURE_HEIGHT - topBarH - playerH;

    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, CAPTURE_WIDTH, topBarH);

    ctx.fillStyle = "#fff";
    ctx.font = "13px Arial";
    ctx.textAlign = "left";
    ctx.fillText("‹", 18, 22);

    ctx.font = "12px Arial";
    ctx.fillText("Media Player", 58, 22);

    drawContain(ctx, video, 0, videoAreaY, CAPTURE_WIDTH, videoAreaH);

    const panelY = CAPTURE_HEIGHT - playerH;

    ctx.fillStyle = "#111";
    ctx.fillRect(0, panelY, CAPTURE_WIDTH, playerH);

    const current = row.middleSeconds;
    const duration = video.duration || row.endSeconds || 1;
    const percent = Math.min(current / duration, 1);

    ctx.fillStyle = "#fff";
    ctx.font = "14px Arial";
    ctx.textAlign = "left";
    ctx.fillText(formatVideoTime(current), 18, panelY + 30);

    ctx.textAlign = "right";
    ctx.fillText(formatVideoTime(duration), CAPTURE_WIDTH - 18, panelY + 30);

    const progressX = 78;
    const progressY = panelY + 22;
    const progressW = CAPTURE_WIDTH - 156;

    ctx.fillStyle = "#9ca3af";
    ctx.fillRect(progressX, progressY, progressW, 4);

    ctx.fillStyle = "#fb923c";
    ctx.fillRect(progressX, progressY, progressW * percent, 4);

    ctx.beginPath();
    ctx.arc(progressX + progressW * percent, progressY + 2, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#5a5a5a";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(progressX + progressW * percent, progressY + 2, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fb923c";
    ctx.fill();

    ctx.textAlign = "left";
    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 20px Arial";

    const shortName =
      videoName.length > 24 ? videoName.slice(0, 24) + "..." : videoName || "Video";

    ctx.fillText(shortName, 18, panelY + 82);

    ctx.beginPath();
    ctx.arc(CAPTURE_WIDTH / 2, panelY + 82, 22, 0, Math.PI * 2);
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(CAPTURE_WIDTH / 2 - 6, panelY + 69);
    ctx.lineTo(CAPTURE_WIDTH / 2 - 6, panelY + 95);
    ctx.lineTo(CAPTURE_WIDTH / 2 + 14, panelY + 82);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();

    ctx.font = "700 13px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = "#e5e7eb";
    ctx.fillText(row.timecode, CAPTURE_WIDTH / 2, panelY + 138);

    const image = await canvasToJpeg(canvas);

    if (shouldUpdateState) {
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, screenshot: image } : r))
      );
    }

    return image;
  }

  async function captureAll() {
    if (!rows.length || capturing) return;

    setCapturing(true);
    setProgress("Preparing screenshots...");

    const updatedRows = [...rows];

    for (let i = 0; i < updatedRows.length; i++) {
      setProgress(`Capturing ${i + 1} of ${updatedRows.length}...`);

      const screenshot = await captureScreenshot(updatedRows[i], false);
      updatedRows[i] = { ...updatedRows[i], screenshot };

      if (i % 10 === 0) {
        setRows([...updatedRows]);
        await sleep(50);
      }
    }

    setRows(updatedRows);
    setProgress("Finished capturing.");
    setCapturing(false);
  }

  function updateComment(id, value) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, comment: value } : r))
    );
  }

  function downloadJPG(row) {
    if (!row.screenshot) return;

    const a = document.createElement("a");
    a.href = row.screenshot;
    a.download = `screenshot_${row.id}.jpg`;
    a.click();
  }

  async function exportSheet() {
    if (!rows.length || exporting) return;

    setExporting(true);
    setProgress("Building Excel file...");

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("SRT Screenshots");

    sheet.columns = [
      { header: "TIMECODE", key: "timecode", width: 32 },
      { header: "SUBTITLE", key: "subtitle", width: 50 },
      { header: "COMMENT", key: "comment", width: 40 },
      { header: "SCREENSHOT", key: "screenshot", width: 24 },
    ];

    sheet.getRow(1).height = 28;
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF111827" },
    };

    sheet.getColumn(4).width = 24;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNumber = i + 2;

      setProgress(`Adding Excel row ${i + 1} of ${rows.length}...`);

      sheet.addRow({
        timecode: r.timecode,
        subtitle: r.subtitle,
        comment: r.comment,
        screenshot: "",
      });

      sheet.getRow(rowNumber).height = 120;

      sheet.getCell(`A${rowNumber}`).alignment = {
        vertical: "middle",
        wrapText: true,
      };

      sheet.getCell(`B${rowNumber}`).alignment = {
        vertical: "middle",
        wrapText: true,
      };

      sheet.getCell(`C${rowNumber}`).alignment = {
        vertical: "middle",
        wrapText: true,
      };

      sheet.getCell(`D${rowNumber}`).alignment = {
        vertical: "middle",
        horizontal: "center",
      };

      if (r.screenshot) {
        const imageId = workbook.addImage({
          base64: r.screenshot.split(",")[1],
          extension: "jpeg",
        });

        sheet.addImage(imageId, {
          tl: {
            col: 3.08,
            row: rowNumber - 0.92,
          },
          br: {
            col: 3.92,
            row: rowNumber - 0.08,
          },
          editAs: "oneCell",
        });
      }

      if (i % 20 === 0) await sleep(30);
    }

    setProgress("Saving Excel file...");

    const buffer = await workbook.xlsx.writeBuffer();

    saveAs(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "srt-video-screenshots.xlsx"
    );

    setProgress("Excel downloaded.");
    setExporting(false);
  }

  return (
    <div className="app">
      <header className="siteHeader">
        <div className="headerText">
          <div className="pill">Video Subtitle Capture</div>
          <h1>SRT Screenshot Studio</h1>
          <p>
            Create clean media-player screenshots from subtitle timestamps, add notes,
            and export everything into a lightweight Excel file.
          </p>
        </div>

        <div className="headerStats">
          <strong>{rows.length}</strong>
          <span>Synced rows</span>
        </div>
      </header>

      <main className="dashboard">
        <section className="card videoCard">
          <div className="cardHeader">
            <div>
              <h2>Upload Video</h2>
              <p>Select the source video used for frame captures.</p>
            </div>
          </div>

          <label className="fileUpload">
            <input type="file" accept="video/*" onChange={loadVideo} />
            <span>{videoName || "Choose video file"}</span>
          </label>

          {videoURL ? (
            <div className="videoWrap">
              <video ref={videoRef} src={videoURL} controls className="video" />
            </div>
          ) : (
            <div className="emptyVideo">
              <div>🎬</div>
              <p>Video preview will appear here</p>
            </div>
          )}
        </section>

        <section className="card inputCard">
          <div className="cardHeader">
            <div>
              <h2>Paste SRT</h2>
              <p>Paste your subtitle content, then sync the rows.</p>
            </div>
          </div>

          <textarea
            value={srtText}
            onChange={(e) => setSrtText(e.target.value)}
            placeholder="Paste your SRT subtitle here..."
          />

          <div className="buttons">
            <button onClick={syncSRT} disabled={capturing || exporting}>
              Sync SRT
            </button>

            <button
              className="secondary"
              onClick={captureAll}
              disabled={capturing || exporting || !rows.length}
            >
              {capturing ? "Capturing..." : "Auto Screenshot All"}
            </button>

            <button onClick={exportSheet} disabled={capturing || exporting || !rows.length}>
              {exporting ? "Exporting..." : "Download Excel"}
            </button>
          </div>

          {progress && <div className="progressText">{progress}</div>}
        </section>
      </main>

      <section className="tableSection">
        <div className="tableHeader">
          <div>
            <h2>Captured Frames</h2>
            <p>Review subtitles, write comments, capture frames, and download images.</p>
          </div>
          <span>{rows.length} rows</span>
        </div>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Timecode</th>
                <th>Subtitle</th>
                <th>Comment</th>
                <th>Screenshot</th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="4" className="emptyTable">
                    No synced subtitles yet. Paste your SRT and click Sync SRT.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="timecode">{row.timecode}</td>
                    <td className="subtitleCell">{row.subtitle}</td>

                    <td>
                      <textarea
                        className="comment"
                        value={row.comment}
                        onChange={(e) => updateComment(row.id, e.target.value)}
                        placeholder="Write comment..."
                      />
                    </td>

                    <td>
                      <button
                        className="small"
                        onClick={() => captureScreenshot(row)}
                        disabled={capturing || exporting}
                      >
                        Screenshot
                      </button>

                      {row.screenshot && (
                        <>
                          <img src={row.screenshot} alt="Captured screenshot" loading="lazy" />

                          <button className="small ghost" onClick={() => downloadJPG(row)}>
                            Download JPG
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}