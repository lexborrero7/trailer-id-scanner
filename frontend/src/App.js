import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [trailerIds, setTrailerIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (e) => {
    setSelectedFiles(Array.from(e.target.files));
    setError('');
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select at least one image file');
      return;
    }

    setLoading(true);
    setError('');
    const allIds = [];

    try {
      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await axios.post('http://localhost:8000/upload/', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        allIds.push(...response.data.ids);
      }

      setTrailerIds(allIds);
    } catch (err) {
      setError('Error uploading images: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      const response = await axios.get('http://localhost:8000/download/', {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'trailer_ids.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError('Error downloading Excel file: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Trailer ID Scanner</h1>
        <p>Upload trailer images to extract ID numbers using OCR</p>

        <div className="upload-section">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="file-input"
          />
          <button onClick={handleUpload} disabled={loading} className="upload-button">
            {loading ? 'Processing...' : 'Upload & Scan'}
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        {trailerIds.length > 0 && (
          <div className="results-section">
            <h2>Detected Trailer IDs:</h2>
            <ul className="id-list">
              {trailerIds.map((id, index) => (
                <li key={index}>{id}</li>
              ))}
            </ul>
            <button onClick={handleDownload} className="download-button">
              Download Excel File
            </button>
          </div>
        )}
      </header>
    </div>
  );
}

export default App;
