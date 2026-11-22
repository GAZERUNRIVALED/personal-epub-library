/**
 * Utility helpers untuk resolusi path ZIP EPUB, MIME type, dan UI feedback.
 */

export function resolveEpubPath(baseFilePath, relativeTarget) {
    if (!relativeTarget) return '';
    // Abaikan data URL, blob URL, atau external HTTP URL
    if (/^(data:|blob:|https?:|mailto:|#)/i.test(relativeTarget)) {
        return relativeTarget;
    }

    // Pisahkan anchor/query jika ada (misal: chapter1.html#sec2)
    const [cleanTarget] = relativeTarget.split('#');
    const [pathWithoutQuery] = cleanTarget.split('?');

    if (pathWithoutQuery.startsWith('/')) {
        return decodeURIComponent(pathWithoutQuery.replace(/^\/+/, ''));
    }

    const baseParts = baseFilePath.split('/');
    baseParts.pop(); // Hapus nama file saat ini

    const targetParts = pathWithoutQuery.split('/');
    for (const part of targetParts) {
        if (part === '.' || part === '') continue;
        if (part === '..') {
            baseParts.pop();
        } else {
            baseParts.push(part);
        }
    }

    const joined = baseParts.join('/');
    try {
        return decodeURIComponent(joined);
    } catch {
        return joined;
    }
}

export function getMimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'svg': 'image/svg+xml',
        'css': 'text/css',
        'ttf': 'font/ttf',
        'otf': 'font/otf',
        'woff': 'font/woff',
        'woff2': 'font/woff2',
        'xhtml': 'application/xhtml+xml',
        'html': 'text/html',
        'htm': 'text/html',
        'ncx': 'application/x-dtbncx+xml',
        'opf': 'application/oebps-package+xml'
    };
    return map[ext] || 'application/octet-stream';
}

export function generateBookId() {
    return 'epub_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

export function showToast(message, duration = 3200) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.2s';
        setTimeout(() => el.remove(), 220);
    }, duration);
}

export function generateFallbackCover(title, author) {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');

    // Background gradient charcoal
    const grad = ctx.createLinearGradient(0, 0, 400, 600);
    grad.addColorStop(0, '#1e1e24');
    grad.addColorStop(1, '#0f0f12');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 400, 600);

    // Bingkai Gold
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, 352, 552);

    // Judul
    ctx.fillStyle = '#e8cfa0';
    ctx.font = 'bold 28px Georgia, serif';
    ctx.textAlign = 'center';

    const words = (title || 'Untitled EPUB').split(' ');
    let line = '';
    let y = 210;
    for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        if (ctx.measureText(testLine).width > 300 && i > 0) {
            ctx.fillText(line.trim(), 200, y);
            line = words[i] + ' ';
            y += 38;
            if (y > 400) break;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line.trim(), 200, y);

    // Penulis
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '18px sans-serif';
    ctx.fillText((author || 'Unknown Author').slice(0, 32), 200, 490);

    return canvas.toDataURL('image/jpeg', 0.85);
}

export function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
