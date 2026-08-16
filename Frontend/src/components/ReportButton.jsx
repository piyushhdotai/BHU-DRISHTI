import { useState } from 'react';
import { API_BASE } from '../api';

function sanitizeFilenameSegment(value) {
  return String(value || 'site').replace(/[^A-Za-z0-9_-]+/g, '_');
}

export default function ReportButton({ siteId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDownload = async () => {
    if (!siteId) {
      setError('Select a site before generating a report.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/reports/generate/${encodeURIComponent(siteId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        let message = 'Unable to generate the report.';
        try {
          const errorPayload = await response.json();
          message = errorPayload?.detail || message;
        } catch {
          // Ignore JSON parsing failures and fall back to a generic message.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeSiteId = sanitizeFilenameSegment(siteId);

      anchor.href = objectUrl;
      anchor.download = `BHU_DRISHTI_Report_${safeSiteId}.pdf`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (requestError) {
      setError(requestError.message || 'Report generation failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
      <button
        type="button"
        onClick={handleDownload}
        disabled={loading}
        style={{
          border: '1px solid #93c5fd',
          background: loading ? '#bfdbfe' : '#1d4ed8',
          color: '#ffffff',
          borderRadius: '6px',
          padding: '8px 14px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: loading ? 'wait' : 'pointer',
          boxShadow: '0 4px 14px rgba(29, 78, 216, 0.18)',
          transition: 'all 0.15s ease',
          fontFamily: 'sans-serif',
          minWidth: '150px',
          opacity: loading ? 0.8 : 1,
        }}
      >
        {loading ? 'Generating PDF...' : 'Download Report'}
      </button>

      {error && (
        <div
          aria-live="polite"
          style={{
            maxWidth: '260px',
            color: '#b91c1c',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            padding: '6px 8px',
            fontSize: '12px',
            fontFamily: 'sans-serif',
            textAlign: 'left',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
