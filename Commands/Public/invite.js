const { ChatInputCommandInteraction, SlashCommandBuilder, Client, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require("discord.js");

function normalizeExternalUrl(value) {
    const rawValue = String(value || "").trim();

    if (!rawValue) {
        return null;
    }

    const normalizedValue = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;

    try {
        return new URL(normalizedValue).toString();
    } catch {
        return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("invite")
        .setDescription("Beni Davet Et"),
    /**
     * @param {Client} client
     * @param {ChatInputCommandInteraction} interaction 
     */
    async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const supportServerLink = client.config?.DestekSunucuLink;
        const supportServerUrl = normalizeExternalUrl(supportServerLink);
        const link_button = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
            .setLabel('Davet Et')
            .setStyle(ButtonStyle.Link)
            .setEmoji('899716843709812777')
            .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`));

        if (supportServerUrl) {
            link_button.addComponents(
                new ButtonBuilder()
                .setLabel('Topluluk Sunucusu')
                .setStyle(ButtonStyle.Link)
                .setEmoji('904316800840380448')
                .setURL(supportServerUrl));
        }
            
        const embed = new EmbedBuilder()
            .setTitle(`${client.user.username} Botuna Destek Ver`)
            .setDescription(`**${client.user.username}** Botunu kullanarak sunucunuza düzen katıp büyüte bilirsiniz.`)
            .setColor('Blurple')
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 1024 }))
        return interaction.editReply({ embeds: [embed], components: [link_button] })
    }
}
