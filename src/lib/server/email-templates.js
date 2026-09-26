/**
 * Materio Email Templates
 * Beautiful HTML templates for system emails.
 */

const SEVERITY_COLORS = {
    critical: '#DC2626',
    major: '#EA580C',
    minor: '#CA8A04',
    cosmetic: '#6B7280',
};

const SEVERITY_EMOJI = {
    critical: '🔴',
    major: '🟠',
    minor: '🟡',
    cosmetic: '⚪',
};

/**
 * Escapes HTML special characters
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Template for Bug Reports (Direct or Fallback)
 */
export function getBugReportTemplate(report, isFallback = false) {
    const color = SEVERITY_COLORS[report.severity] || '#6B7280';
    const emoji = SEVERITY_EMOJI[report.severity] || '⚪';
    const statusBadge = isFallback
        ? '<span style="background:#FEF2F2;color:#991B1B;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold;margin-left:8px;border:1px solid #FEE2E2;">DB OFFLINE FALLBACK</span>'
        : '';

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#1f2937;">
  <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
    <!-- Header -->
    <div style="background:${color};padding:24px;color:#fff;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:0.9;margin-bottom:8px;font-weight:600;">New Bug Report ${statusBadge}</div>
      <h1 style="margin:0;font-size:20px;font-weight:700;line-height:1.3;">${emoji} ${escapeHtml(report.title)}</h1>
    </div>

    <!-- Info Grid -->
    <div style="padding:24px;background:#ffffff;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:10px 0;width:120px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Severity</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f3f4f6;">
            <strong style="color:${color};text-transform:uppercase;">${report.severity}</strong>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Affected Area</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f3f4f6;">${escapeHtml(report.affectedArea)}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Reporter</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f3f4f6;">${escapeHtml(report.email || 'Anonymous')}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">App Version</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f3f4f6;"><code>${report.meta?.appVersion || 'v4.x'}</code></td>
        </tr>
      </table>

      <!-- Description Section -->
      <div style="margin-top:24px;">
        <h3 style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Description</h3>
        <div style="background:#f8fafc;padding:16px;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap;border:1px solid #e2e8f0;">${escapeHtml(report.description)}</div>
      </div>

      <!-- Steps Section -->
      ${report.stepsToReproduce ? `
      <div style="margin-top:20px;">
        <h3 style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Steps to Reproduce</h3>
        <div style="background:#f8fafc;padding:16px;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap;border:1px solid #e2e8f0;">${escapeHtml(report.stepsToReproduce)}</div>
      </div>` : ''}

      <!-- Metadata -->
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;">
        <strong>Session ID:</strong> ${report.meta?.sessionId || 'N/A'}<br>
        <strong>IP:</strong> ${report.meta?.ip || 'N/A'}<br>
        <strong>User Agent:</strong> ${report.meta?.userAgent || 'N/A'}<br>
        <strong>Timestamp:</strong> ${new Date().toISOString()}
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;">
      Materio Dashboard • Built by JTC
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * General Alert Template
 */
export function getAlertTemplate(subject, message, severity = 'minor') {
    const color = SEVERITY_COLORS[severity] || '#6B7280';
    const emoji = SEVERITY_EMOJI[severity] || '⚪';

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#1f2937;">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <div style="background:${color};padding:16px 20px;color:#fff;">
      <strong style="font-size:16px;display:block;">${emoji} ${escapeHtml(subject)}</strong>
      <div style="font-size:12px;opacity:0.85;margin-top:4px;">Severity: ${severity} • ${new Date().toISOString()}</div>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.6;color:#1f2937;white-space:pre-wrap;">${escapeHtml(message)}</div>
    <div style="padding:12px 20px;background:#f9fafb;font-size:11px;color:#9ca3af;text-align:center;border-top:1px solid #f3f4f6;">
      Materio Health Monitor
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Contribution arrival notification template
 */
export function getContributionNotificationTemplate(contribution) {
  const LOGO_CID = 'materio-logo';
    const {
        cid,
        contributor,
        submittedAt,
        semester,
        subject,
        category,
        files,
        commitSha,
    } = contribution;

    const safeFiles = Array.isArray(files) ? files : [];
    const fileRows = safeFiles
        .map((file) => {
            const filename = escapeHtml(file.filename || file.name || 'unknown.pdf');
            const size = Number(file.size || 0);
            const sizeLabel = size > 0 ? `${(size / 1024 / 1024).toFixed(2)} MB` : 'N/A';
            return `
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#1f2937;">${filename}</td>
                <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;text-align:right;">${sizeLabel}</td>
              </tr>
            `;
        })
        .join('');

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#1f2937;">
  <div style="max-width:620px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
    <div style="padding:18px 24px 8px;background:#ffffff;border-bottom:1px solid #f3f4f6;">
      <img src="cid:${LOGO_CID}" alt="materio" width="150" style="display:block;height:auto;" />
    </div>
    <div style="background:#ff8200;padding:20px 24px;color:#ffffff;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:0.92;margin-bottom:8px;font-weight:700;">New Contribution Received</div>
      <h1 style="margin:0;font-size:20px;font-weight:700;line-height:1.35;">Contribution Notification</h1>
    </div>

    <div style="padding:24px;">
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 14px;margin-bottom:18px;">
        <div style="font-size:12px;color:#9a3412;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">CID</div>
        <div style="font-size:16px;color:#7c2d12;font-weight:800;letter-spacing:0.6px;margin-top:4px;">${escapeHtml(cid || 'N/A')}</div>
      </div>

      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:10px 0;width:140px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Contributor</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f3f4f6;"><strong>${escapeHtml(contributor || 'Anonymous')}</strong></td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Submitted At</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f3f4f6;">${escapeHtml(submittedAt || 'N/A')}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Semester</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f3f4f6;">${escapeHtml(semester || 'N/A')}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Subject</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f3f4f6;">${escapeHtml(subject || 'N/A')}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Category</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f3f4f6;">${escapeHtml(category || 'N/A')}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Commit SHA</td>
          <td style="padding:10px 0;font-size:14px;border-bottom:1px solid #f3f4f6;"><code>${escapeHtml(commitSha || 'N/A')}</code></td>
        </tr>
      </table>

      <div style="margin-top:20px;">
        <h3 style="margin:0 0 10px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Uploaded Files</h3>
        <div style="background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;">
          <table style="width:100%;border-collapse:collapse;">
            <tbody>
              ${fileRows || '<tr><td style="padding:8px 0;font-size:13px;color:#6b7280;">No file details available</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div style="background:#f9fafb;padding:14px 18px;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;">
      Materio Contributions Insights
    </div>
  </div>
</body>
</html>
  `;
}
