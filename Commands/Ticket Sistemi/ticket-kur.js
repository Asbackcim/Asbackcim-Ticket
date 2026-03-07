const {
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    Client,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require("discord.js");
const { BRANDING, applyFooter } = require("../../services/branding");

module.exports = {
    subCommand: "ticket.kur",
    /**
     * @param {Client} client
     * @param {ChatInputCommandInteraction} interaction 
     */
    async execute(interaction, client) {
        const { guild, channel, options } = interaction;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })

        const kanal = options.getChannel("kanal");

        const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setEmoji(`🎫`)
                .setLabel(`Ticket Oluştur!`)
                .setStyle(ButtonStyle.Primary)
                .setCustomId("ticketolustur")
        )

    const embed = applyFooter(new EmbedBuilder()
    .setAuthor({ name: guild.name, iconURL: guild.iconURL() || "https://cdn.discordapp.com/emojis/1119027206908284948.gif" })
    .setTitle(`${BRANDING.shortName} Ticket Sistemi`)
    .setDescription(`Aşağıdaki **Ticket Oluştur!** butonuna tıklayarak ticket oluştura bilirsiniz.`)
    .setColor("Blurple"))
    
    if (kanal) {
        kanal.send({ embeds: [embed], components: [row] });
        await interaction.editReply({ content: `✅ Embed başarıyla <#${kanal.id}> kanalına gönderildi!` })
    } else {
        channel.send({ embeds: [embed], components: [row] });
        await interaction.editReply({ content: `✅ Embed başarıyla <#${channel.id}> kanalına gönderildi!` })
    }
    }
}
