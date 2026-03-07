const BRANDING = Object.freeze({
  productName: "Asback Ticket",
  shortName: "Asback Ticket",
  panelTitle: "Asback Ticket Panel",
  footerNote: "Asback Ticket Panel",
  attribution: "VDS, VPS ve hosting destek operasyonlari icin ozellestirildi",
  presence: "Asback Ticket",
  supportEmail: "",
  supportTagline: "Discord ticket ve destek yonetimi",
  promoText: "Yeni siparislerde hizli destek ve kesintisiz operasyon takibi",
});

function getFooterText(extraText = "") {
  const baseText = String(
    BRANDING.footerNote || BRANDING.shortName || BRANDING.productName || "",
  ).trim();
  const suffixText = String(extraText || "").trim();

  if (baseText && suffixText) {
    return `${baseText} | ${suffixText}`;
  }

  return baseText || suffixText || null;
}

function applyFooter(embed, extraText = "") {
  const footerText = getFooterText(extraText);

  if (!footerText) {
    return embed;
  }

  return embed.setFooter({ text: footerText });
}

module.exports = { BRANDING, getFooterText, applyFooter };
