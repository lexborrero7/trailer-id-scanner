import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, cleanTrailerId, mergeScans, responseMessage, timeLabel } from './scanner.js';

const icons = {
  camera: <><path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3h5Z"/><circle cx="12" cy="13" r="3.5"/></>,
  upload: <><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14v5h14v-5"/></>,
  file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
  edit: <><path d="m4 20 4.2-1 10.7-10.7-3.2-3.2L5 15.8 4 20Z"/><path d="m13.8 7 3.2 3.2"/></>,
  signal: <><path d="M5 15a10 10 0 0 1 14 0M8 18a6 6 0 0 1 8 0"/><circle cx="12" cy="21" r=".5" fill="currentColor"/></>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19v2h14v-2"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
};

function Icon({ name, size = 20 }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}

function App() {
  const [mode, setMode] = useState('camera');
  const [records, setRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem('yardscan-records')) || []; } catch { return []; }
  });
  const [cameraState, setCameraState] = useState('off');
  const [busy, setBusy] = useState(false);
  const [autoScan, setAutoScan] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [manualId, setManualId] = useState('');
  const [notice, setNotice] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    localStorage.setItem('yardscan-records', JSON.stringify(records));
  }, [records]);

  const showNotice = useCallback((message, type = 'success') => {
    setNotice({ message, type });
    window.setTimeout(() => setNotice(null), 4000);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraState('off');
    setAutoScan(false);
  }, []);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      showNotice('This browser does not support camera access. Try uploading a photo instead.', 'error');
      return;
    }
    setCameraState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraState('on');
    } catch {
      setCameraState('error');
      showNotice('Camera access was blocked. Allow access in your browser or upload a file.', 'error');
    }
  };

  const addScans = useCallback((scans, source) => {
    const summary = mergeScans(records, scans, source);
    setRecords(summary.records);
    if (!scans.length) showNotice('No trailer ID found. Move closer and keep the ID inside the frame.', 'error');
    else if (summary.added === 0) showNotice('That trailer is already in this session.', 'info');
    else showNotice(`${summary.added} trailer ${summary.added === 1 ? 'ID' : 'IDs'} added.`);
  }, [records, showNotice]);

  const scanFile = useCallback(async (file, source) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const isVideo = file.type.startsWith('video/');
      const data = new FormData();
      data.append('file', file, file.name || 'camera-frame.jpg');
      if (!isVideo) data.append('source', source);
      if (isVideo) {
        data.append('interval_seconds', '1.5');
        data.append('max_frames', '20');
      }
      const response = await fetch(`${API_URL}/api/scan/${isVideo ? 'video' : 'image'}`, { method: 'POST', body: data });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = await response.json();
      addScans(payload.scans || [], source);
    } catch (error) {
      showNotice(error.message || 'Could not reach the scanner service.', 'error');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [addScans, showNotice]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || busyRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && scanFile(new File([blob], 'camera-frame.jpg', { type: 'image/jpeg' }), 'Live camera'), 'image/jpeg', 0.92);
  }, [scanFile]);

  useEffect(() => {
    if (!autoScan || cameraState !== 'on') return undefined;
    captureFrame();
    const timer = window.setInterval(captureFrame, 4000);
    return () => window.clearInterval(timer);
  }, [autoScan, cameraState, captureFrame]);

  const chooseMode = (next) => {
    if (next !== 'camera') stopCamera();
    setMode(next);
  };

  const uploadSelected = () => {
    if (selectedFile) scanFile(selectedFile, selectedFile.type.startsWith('video/') ? 'Recorded video' : 'Uploaded image');
  };

  const addManual = (event) => {
    event.preventDefault();
    const value = cleanTrailerId(manualId);
    if (value.length < 4) return showNotice('Enter at least four letters or numbers.', 'error');
    addScans([{ trailer_id: value, confidence: null }], 'Manual entry');
    setManualId('');
  };

  const updateRecord = (id, field, value) => {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, [field]: field === 'trailer_id' ? cleanTrailerId(value) : value } : record));
  };

  const exportRecords = async (format) => {
    if (!records.length) return showNotice('Scan or add a trailer before exporting.', 'error');
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/api/export?format=${format}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: records.map(({ id, ...record }) => record) }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/)?.[1] || `trailer-scans.${format}`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
      showNotice(`${format.toUpperCase()} file downloaded.`);
    } catch (error) {
      showNotice(error.message || 'Export failed.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="YardScan home">
          <span className="brand-mark"><Icon name="camera" size={22} /></span>
          <span><strong>YardScan</strong><small>TRAILER ID SCANNER</small></span>
        </a>
        <div className="service-status"><span className="status-dot" />Local session <span className="status-separator" /> {records.length} captured</div>
      </header>

      <main id="top">
        <section className="hero">
          <p className="eyebrow"><span /> FAST · ACCURATE · ORGANIZED</p>
          <h1>Turn trailer IDs into<br /><em>clean records.</em></h1>
          <p className="hero-copy">Point your camera or upload recorded footage. YardScan finds the trailer IDs and prepares a spreadsheet your team can use.</p>
          <div className="steps">
            <span><b>1</b> Capture</span><i /><span><b>2</b> Review</span><i /><span><b>3</b> Export</span>
          </div>
        </section>

        <section className="workspace" aria-label="Scanner workspace">
          <div className="workspace-head">
            <div><p className="section-kicker">NEW SCAN</p><h2>Capture a trailer ID</h2></div>
            <div className="mode-tabs" role="tablist">
              <button className={mode === 'camera' ? 'active' : ''} onClick={() => chooseMode('camera')}><Icon name="camera" size={17} /> Live camera</button>
              <button className={mode === 'upload' ? 'active' : ''} onClick={() => chooseMode('upload')}><Icon name="upload" size={17} /> Upload media</button>
            </div>
          </div>

          {mode === 'camera' ? (
            <div className="capture-grid">
              <div className={`camera-view ${cameraState === 'on' ? 'camera-on' : ''}`}>
                <video ref={videoRef} autoPlay playsInline muted />
                {cameraState !== 'on' && <div className="camera-empty"><span className="camera-ring"><Icon name="camera" size={32} /></span><h3>Camera ready when you are</h3><p>Use the rear camera and keep the full trailer ID inside the guide.</p><button className="primary" onClick={startCamera} disabled={cameraState === 'starting'}>{cameraState === 'starting' ? 'Starting camera…' : 'Start camera'}</button></div>}
                {cameraState === 'on' && <><span className="corner top-left"/><span className="corner top-right"/><span className="corner bottom-left"/><span className="corner bottom-right"/><div className="live-badge"><span/> LIVE</div><div className="frame-hint">ALIGN TRAILER ID INSIDE FRAME</div></>}
              </div>
              <aside className="capture-controls">
                <p className="aside-label">CAPTURE CONTROLS</p>
                <div className="tip"><span>01</span><div><b>Fill the frame</b><p>Move close enough that the letters are sharp and readable.</p></div></div>
                <div className="tip"><span>02</span><div><b>Hold steady</b><p>Avoid glare, deep shadow, and motion blur.</p></div></div>
                {cameraState === 'on' && <>
                  <button className="primary wide" onClick={captureFrame} disabled={busy}>{busy ? 'Reading frame…' : 'Scan current frame'}</button>
                  <label className="auto-toggle"><input type="checkbox" checked={autoScan} onChange={(event) => setAutoScan(event.target.checked)} /><span /> Auto-scan every 4 seconds</label>
                  <button className="text-button" onClick={stopCamera}>Turn camera off</button>
                </>}
              </aside>
            </div>
          ) : (
            <div className="upload-panel">
              <label className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); setSelectedFile(event.dataTransfer.files[0] || null); }}>
                <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(event) => setSelectedFile(event.target.files[0] || null)} />
                <span className="upload-icon"><Icon name="upload" size={28} /></span>
                <h3>{selectedFile ? selectedFile.name : 'Drop a photo or video here'}</h3>
                <p>{selectedFile ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB · Ready to scan` : 'or click to browse · JPG, PNG, WebP, MP4, MOV, or WebM · up to 150 MB'}</p>
              </label>
              <button className="primary" disabled={!selectedFile || busy} onClick={uploadSelected}>{busy ? 'Scanning media…' : 'Scan selected media'}</button>
              {busy && selectedFile?.type.startsWith('video/') && <p className="processing-note">Reviewing frames from the video. Longer clips may take a minute.</p>}
            </div>
          )}
        </section>

        <section className="records-section">
          <div className="records-head">
            <div><p className="section-kicker">SESSION LOG</p><h2>Trailer records <span>{records.length}</span></h2></div>
            <div className="export-actions"><button onClick={() => exportRecords('csv')} disabled={!records.length || busy}><Icon name="file" size={17}/> CSV</button><button className="dark-button" onClick={() => exportRecords('xlsx')} disabled={!records.length || busy}><Icon name="download" size={17}/> Excel</button></div>
          </div>

          <form className="manual-form" onSubmit={addManual}>
            <div><label htmlFor="manual-id">Add an ID manually</label><p>Useful when a label is damaged or difficult to scan.</p></div>
            <div className="manual-input"><input id="manual-id" value={manualId} onChange={(event) => setManualId(cleanTrailerId(event.target.value))} placeholder="e.g. LR7664" autoComplete="off"/><button className="primary" type="submit"><Icon name="plus" size={18}/> Add ID</button></div>
          </form>

          {records.length ? (
            <div className="table-wrap"><table><thead><tr><th>Trailer ID</th><th>Captured</th><th>Source</th><th>Confidence</th><th>Notes</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{records.map((record) => <tr key={record.id}>
              <td><input className="id-input" aria-label="Trailer ID" value={record.trailer_id} onChange={(event) => updateRecord(record.id, 'trailer_id', event.target.value)}/></td>
              <td>{timeLabel(record.captured_at)}</td><td><span className="source-pill">{record.source}</span></td>
              <td>{record.confidence == null ? <span className="muted">Manual</span> : <span className={`confidence ${record.confidence < .6 ? 'low' : ''}`}><i style={{'--score': `${Math.round(record.confidence * 100)}%`}}/>{Math.round(record.confidence * 100)}%</span>}</td>
              <td><input aria-label="Notes" value={record.notes} placeholder="Add note…" onChange={(event) => updateRecord(record.id, 'notes', event.target.value)}/></td>
              <td><button className="icon-button" aria-label={`Remove ${record.trailer_id}`} onClick={() => setRecords((current) => current.filter((item) => item.id !== record.id))}><Icon name="trash" size={17}/></button></td>
            </tr>)}</tbody></table></div>
          ) : (
            <div className="empty-records"><span><Icon name="table" size={28}/></span><h3>Your scan list will appear here</h3><p>Start the camera, upload media, or enter an ID manually.</p></div>
          )}
          {records.length > 0 && <div className="table-footer"><p><Icon name="check" size={15}/> Saved in this browser automatically</p><button className="text-button danger" onClick={() => window.confirm('Clear every trailer from this session?') && setRecords([])}>Clear session</button></div>}
        </section>
      </main>

      <footer><div className="footer-brand"><span className="brand-mark"><Icon name="camera" size={17}/></span><b>YardScan</b></div><p>Built for the yard. Ready for the office.</p></footer>
      {notice && <div className={`toast ${notice.type}`} role="status"><span>{notice.type === 'error' ? '!' : notice.type === 'info' ? 'i' : '✓'}</span>{notice.message}<button onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="close" size={15}/></button></div>}
    </div>
  );
}

export default App;
