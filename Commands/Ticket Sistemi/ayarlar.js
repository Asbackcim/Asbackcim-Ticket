const { ChatInputCommandInteraction, SlashCommandBuilder, Client, EmbedBuilder, codeBlock, MessageFlags } = require("discord.js");
const mzrdb = require('croxydb');
const { BRANDING } = require("../../services/branding");

module.exports = {
    subCommand: "ticket.ayarlar",
    /**
     * 
     * @param {ChatInputCommandInteraction} interaction 
     * @param {Client} client 
     */

    async execute(interaction, client) {
        const { guild } = interaction;
        const panelConfig = client.config?.panel || {};

        const embed = new EmbedBuilder()
            .setTitle("Sunucu Ayarları ⚙️")
            .setColor("#5865F2");

        const logKanalId = await mzrdb.get(`mzrlog_${guild.id}`);
        const logKanal = guild.channels.cache.get(logKanalId);
        if (logKanal) {
            embed.addFields([
                { name: "Ticket Log Kanalı", value: logKanal.toString(), inline: true }
            ]);
        } else {
            embed.addFields([
                { name: "Ticket Log Kanalı", value: `❌`, inline: true }
            ]);
        }

        const yetkiliRolID = await mzrdb.get(`mzryetkili_${guild.id}`);
        const yetkiliRol = guild.roles.cache.get(yetkiliRolID);
        if (yetkiliRol) {
            embed.addFields([
                { name: "Ticket Yetkili Rolü", value: yetkiliRol.toString(), inline: true }
            ]);
        } else {
            embed.addFields([
                { name: "Ticket Yetkili Rolü", value: `❌`, inline: true }
            ]);
        }

        const limitSayı = await mzrdb.get(`mzrlimit_${guild.id}`);
        if (limitSayı) {
            embed.addFields([
                { name: "Ticket Oluşturma Limiti", value: limitSayı.toString(), inline: true }
            ]);
        } else {
            embed.addFields([
                { name: "Ticket Oluşturma Limiti", value: `❌`, inline: true }
            ]);
        }

        const kategori = await mzrdb.get(`mzrkategori_${guild.id}`);
        const kategoriBu = guild.channels.cache.get(kategori);
        if (kategori) {
            embed.addFields([
                { name: "Ticket Kategorisi", value: kategoriBu.toString(), inline: true }
            ]);
        } else {
            embed.addFields([
                { name: "Ticket Kategorisi", value: `❌`, inline: true }
            ]);
        }

        if (panelConfig.enabled !== false) {
            const panelHost = panelConfig.host || "127.0.0.1";
            const panelPort = panelConfig.port || 3000;

            embed.addFields([
                { name: "Web Panel", value: `http://${panelHost}:${panelPort}`, inline: false },
                { name: "Panel Notu", value: BRANDING.attribution, inline: false }
            ]);
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
