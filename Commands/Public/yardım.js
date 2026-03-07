const { ChatInputCommandInteraction, SlashCommandBuilder, Client, EmbedBuilder, MessageFlags } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
    .setName("yardım")
    .setDescription("Yardım Menüsünü Gösterir"),
    /**
     * @param {Client} client
     * @param {ChatInputCommandInteraction} interaction 
     */
    async execute(interaction, client){
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const embed = new EmbedBuilder()
    .setTitle("Yardım Menüm")
    .addFields([
    { name: "Yetkili Ayarlamalı Komutlarım", value: `
🎫 **</ticket kur:0>**
Destek sistemi embedını gönderir.

🎫 **</ticket ayarla-log:0>**
Destek log kanalını ayarlarsınız.

🎫 **</ticket ayarla-yetkili:0>**
Destek yetkilisi rolünü ayarlarsınız.

🎫 **</ticket ayarla-limit:0>**
Destek talebi oluşturma limiti ayarlarsınız.

🎫 **</ticket ayarla-kategori:0>**
Destek taleplerinin bulunmasını istediğiniz kategoriyi ayarlarsınız.

🎫 **</ticket sıfırla:0>**
Destek sisteminde sıfırlamak istediğinizi sıfırlarsınız.

🎫 **</ticket ayarlar:0>**
Ayarları görüntülersiniz.`, inline: false},
    { name: "Kullanıcı Komutlarım", value: `
🙍‍♂️ **</yardım:0>**
Yardım menüsünü gösterir.

🙍‍♂️ **</ping:0>**
Botun pingini gösterir.

🙍‍♂️ **</invite:0>**
Botu davet edersiniz ve destek sunucusuna katılabilirsiniz.`, inline: true},
    ])
    .setColor("Blurple")
    await interaction.editReply({embeds: [embed] });
    }
}
