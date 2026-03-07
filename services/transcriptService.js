const fs = require("fs");
const path = require("path");
const { TRANSCRIPTS_DIR } = require("./panelStore");

function sanitizeTranscriptFileName(value) {
  const fileName = path.basename(String(value || "").trim());

  if (!fileName || !fileName.toLowerCase().endsWith(".html")) {
    return null;
  }

  return fileName;
}

function getStoredTranscriptInfo(fileName) {
  const normalizedFileName = sanitizeTranscriptFileName(fileName);

  if (!normalizedFileName) {
    return null;
  }

  const absolutePath = path.join(TRANSCRIPTS_DIR, normalizedFileName);

  return {
    fileName: normalizedFileName,
    absolutePath,
    relativePath: path.join("storage", "transcripts", normalizedFileName).replace(/\\/g, "/"),
    exists: fs.existsSync(absolutePath),
  };
}

async function ensureStoredTranscript({ transcriptFileName, transcriptUrl }) {
  const transcript = getStoredTranscriptInfo(transcriptFileName);

  if (!transcript) {
    return null;
  }

  if (transcript.exists) {
    return transcript;
  }

  if (!transcriptUrl || typeof fetch !== "function") {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(transcriptUrl, {
      headers: {
        "User-Agent": "Asback Ticket Panel",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
    fs.writeFileSync(transcript.absolutePath, html, "utf8");

    return {
      ...transcript,
      exists: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function renderEmbeds(message) {
  if (!message.embeds?.length) {
    return "";
  }

  const blocks = message.embeds.map((embed) => {
    const title = embed.title ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : "";
    const description = embed.description
      ? `<div class="embed-description">${escapeHtml(embed.description).replace(/\n/g, "<br>")}</div>`
      : "";

    return `<div class="embed-block">${title}${description}</div>`;
  });

  return `<div class="embed-list">${blocks.join("")}</div>`;
}

function renderAttachments(message) {
  if (!message.attachments?.size) {
    return "";
  }

  const items = [...message.attachments.values()].map((attachment) => {
    const label = escapeHtml(attachment.name || "Dosya");
    const url = escapeHtml(attachment.url);
    return `<li><a href="${url}" target="_blank" rel="noreferrer">${label}</a></li>`;
  });

  return `<ul class="attachment-list">${items.join("")}</ul>`;
}

function renderMessage(message) {
  const authorName = escapeHtml(
    message.member?.displayName || message.author?.globalName || message.author?.username || "Bilinmeyen Kullanici",
  );
  const avatarUrl = message.author?.displayAvatarURL?.({ extension: "png", size: 128 }) || "";
  const createdAt = formatDate(message.createdAt || Date.now());
  const content = escapeHtml(message.content || "").replace(/\n/g, "<br>");

  return `
    <article class="message">
      <img class="avatar" src="${escapeHtml(avatarUrl)}" alt="${authorName}" />
      <div class="message-body">
        <header class="message-header">
          <strong>${authorName}</strong>
          <span>${createdAt}</span>
        </header>
        <div class="message-content">${content || '<span class="muted">Metin yok</span>'}</div>
        ${renderEmbeds(message)}
        ${renderAttachments(message)}
      </div>
    </article>
  `;
}

function renderTranscript({ channel, messages, ticket }) {
  const transcriptItems = messages.map(renderMessage).join("");
  const opener = escapeHtml(ticket?.openedByTag || ticket?.openedById || "Bilinmiyor");
  const ticketType = escapeHtml(ticket?.ticketType?.label || "Belirtilmedi");

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(channel.name)} transcript</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101726;
      --panel: #162033;
      --line: rgba(255, 255, 255, 0.08);
      --text: #f6f7fb;
      --muted: #9eacbf;
      --accent: #4ec4b1;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(78, 196, 177, 0.15), transparent 34%),
        linear-gradient(180deg, #111826 0%, #0b1220 100%);
      color: var(--text);
    }
    .wrapper {
      max-width: 1080px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .hero {
      padding: 24px;
      border-radius: 24px;
      background: rgba(22, 32, 51, 0.92);
      border: 1px solid var(--line);
      margin-bottom: 20px;
    }
    .hero h1 {
      margin: 0 0 8px;
      font-size: 28px;
    }
    .hero p {
      margin: 6px 0;
      color: var(--muted);
    }
    .messages {
      display: grid;
      gap: 12px;
    }
    .message {
      display: grid;
      grid-template-columns: 48px 1fr;
      gap: 12px;
      padding: 16px;
      border-radius: 20px;
      background: rgba(22, 32, 51, 0.92);
      border: 1px solid var(--line);
    }
    .avatar {
      width: 48px;
      height: 48px;
      border-radius: 999px;
      object-fit: cover;
      background: rgba(255, 255, 255, 0.06);
    }
    .message-header {
      display: flex;
      gap: 12px;
      align-items: baseline;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .message-header span,
    .muted {
      color: var(--muted);
      font-size: 13px;
    }
    .message-content {
      line-height: 1.55;
      word-break: break-word;
    }
    .embed-list {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .embed-block {
      border-left: 4px solid var(--accent);
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.04);
    }
    .embed-title {
      font-weight: 700;
      margin-bottom: 6px;
    }
    .attachment-list {
      margin: 10px 0 0;
      padding-left: 18px;
    }
    a {
      color: #7ce1d0;
    }
  </style>
</head>
<body>
  <main class="wrapper">
    <section class="hero">
      <h1>#${escapeHtml(channel.name)}</h1>
      <p>Acen kisi: ${opener}</p>
      <p>Ticket tipi: ${ticketType}</p>
      <p>Mesaj sayisi: ${messages.length}</p>
    </section>
    <section class="messages">
      ${transcriptItems || '<article class="message"><div></div><div class="message-body"><span class="muted">Kayitli mesaj bulunamadi.</span></div></article>'}
    </section>
  </main>
</body>
</html>`;
}

async function saveTranscript({ channel, messages, ticket }) {
  const fileName = `ticket-${channel.id}-${Date.now()}.html`;
  const absolutePath = path.join(TRANSCRIPTS_DIR, fileName);
  const html = renderTranscript({ channel, messages, ticket });

  fs.writeFileSync(absolutePath, html, "utf8");

  return {
    fileName,
    absolutePath,
    relativePath: path.join("storage", "transcripts", fileName).replace(/\\/g, "/"),
    buffer: Buffer.from(html, "utf8"),
    messageCount: messages.length,
  };
}

module.exports = {
  ensureStoredTranscript,
  getStoredTranscriptInfo,
  saveTranscript,
};
