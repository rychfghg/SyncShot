import { useRef, useState } from "react";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";
import "./App.css";

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

function drawCover(ctx, video, x, y, w, h) {
  const videoRatio = video.videoWidth / video.videoHeight;
  const areaRatio = w / h;

  let sx = 0;
  let sy = 0;
  let sw = video.videoWidth;
  let sh = video.videoHeight;

  if (videoRatio > areaRatio) {
    sw = video.videoHeight * areaRatio;
    sx = (video.videoWidth - sw) / 2;
  } else {
    sh = video.videoWidth / areaRatio;
    sy = (video.videoHeight - sh) / 2;
  }

  ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
}

function parseSRT(srt) {
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
        start,
        end,
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
    canvas.width = 1080;
    canvas.height = 1920;

    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const videoX = 0;
    const videoY = 120;
    const videoW = canvas.width;
    const videoH = 1180;

    drawCover(ctx, video, videoX, videoY, videoW, videoH);

    const panelY = 1300;

    ctx.fillStyle = "#111";
    ctx.fillRect(0, panelY, canvas.width, canvas.height - panelY);

    const current = row.middleSeconds;
    const duration = video.duration || row.endSeconds || 1;
    const percent = Math.min(current / duration, 1);

    const progressX = 130;
    const progressY = 1450;
    const progressW = 820;
    const progressH = 8;

    ctx.fillStyle = "#8b8b8b";
    ctx.fillRect(progressX, progressY, progressW, progressH);

    ctx.fillStyle = "#ff7a2f";
    ctx.fillRect(progressX, progressY, progressW * percent, progressH);

    ctx.beginPath();
    ctx.arc(progressX + progressW * percent, progressY + 4, 22, 0, Math.PI * 2);
    ctx.fillStyle = "#555";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(progressX + progressW * percent, progressY + 4, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#ff7a2f";
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "32px Arial";
    ctx.textAlign = "left";
    ctx.fillText(formatVideoTime(current), 40, 1463);

    ctx.textAlign = "right";
    ctx.fillText(formatVideoTime(duration), 1040, 1463);

    ctx.textAlign = "left";
    ctx.font = "700 44px Arial";

    const cleanName = videoName || "Video";
    const shortName = cleanName.length > 34 ? cleanName.slice(0, 34) + "..." : cleanName;

    ctx.fillText(shortName, 40, 1580);

    ctx.beginPath();
    ctx.arc(540, 1700, 50, 0, Math.PI * 2);
    ctx.strokeStyle = "#ff7a2f";
    ctx.lineWidth = 7;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(525, 1670);
    ctx.lineTo(525, 1730);
    ctx.lineTo(575, 1700);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();

    ctx.font = "700 34px Arial";
    ctx.textAlign = "center";
    ctx.fillStyle = "#e5e7eb";
    ctx.fillText(row.timecode, canvas.width / 2, 1840);

    const image = canvas.toDataURL("image/png");

    if (shouldUpdateState) {
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, screenshot: image } : r))
      );
    }

    return image;
  }

  async function captureAll() {
    setCapturing(true);

    const updatedRows = [];

    for (const row of rows) {
      const screenshot = await captureScreenshot(row, false);
      updatedRows.push({ ...row, screenshot });
    }

    setRows(updatedRows);
    setCapturing(false);
  }

  function updateComment(id, value) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, comment: value } : r))
    );
  }

  function downloadPNG(row) {
    if (!row.screenshot) return;

    const a = document.createElement("a");
    a.href = row.screenshot;
    a.download = `screenshot_${row.id}.png`;
    a.click();
  }

  async function exportSheet() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("SRT Screenshots");

    sheet.columns = [
      { header: "TIMECODE", key: "timecode", width: 32 },
      { header: "SUBTITLE", key: "subtitle", width: 50 },
      { header: "COMMENT", key: "comment", width: 40 },
      { header: "SCREENSHOT", key: "screenshot", width: 32 },
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF111827" },
    };

    rows.forEach((r, index) => {
      const rowNumber = index + 2;

      sheet.addRow({
        timecode: r.timecode,
        subtitle: r.subtitle,
        comment: r.comment,
      });

      sheet.getRow(rowNumber).height = 190;
      sheet.getCell(`A${rowNumber}`).alignment = { vertical: "middle", wrapText: true };
      sheet.getCell(`B${rowNumber}`).alignment = { vertical: "middle", wrapText: true };
      sheet.getCell(`C${rowNumber}`).alignment = { vertical: "middle", wrapText: true };

      if (r.screenshot) {
        const base64 = r.screenshot.split(",")[1];

        const imageId = workbook.addImage({
          base64,
          extension: "png",
        });

        sheet.addImage(imageId, {
          tl: { col: 3, row: rowNumber - 1 },
          ext: { width: 120, height: 210 },
        });
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();

    saveAs(
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "srt-video-screenshots.xlsx"
    );
  }

  return (
    <div className="app">
      <header className="hero">
        <h1>SRT Video Screenshot Tool</h1>
        <p>Capture full-screen portrait screenshots with real video timecode.</p>
      </header>

      <div className="panel">
        <label>Upload Video</label>
        <input type="file" accept="video/*" onChange={loadVideo} />

        {videoURL && (
          <div className="videoWrap">
            <video ref={videoRef} src={videoURL} controls className="video" />
          </div>
        )}
      </div>

      <div className="panel">
        <label>Paste SRT Here</label>

        <textarea
          value={srtText}
          onChange={(e) => setSrtText(e.target.value)}
          placeholder="Paste your SRT subtitle here..."
        />

        <div className="buttons">
          <button onClick={syncSRT}>Sync SRT</button>

          <button onClick={captureAll} disabled={capturing || !rows.length}>
            {capturing ? "Capturing..." : "Auto Screenshot All"}
          </button>

          <button onClick={exportSheet} disabled={!rows.length}>
            Download Excel
          </button>
        </div>
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
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="timecode">{row.timecode}</td>

                <td>{row.subtitle}</td>

                <td>
                  <textarea
                    className="comment"
                    value={row.comment}
                    onChange={(e) => updateComment(row.id, e.target.value)}
                    placeholder="Write comment..."
                  />
                </td>

                <td>
                  <button className="small" onClick={() => captureScreenshot(row)}>
                    Screenshot
                  </button>

                  {row.screenshot && (
                    <>
                      <img src={row.screenshot} alt="Captured screenshot" />

                      <button className="small ghost" onClick={() => downloadPNG(row)}>
                        Download PNG
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}