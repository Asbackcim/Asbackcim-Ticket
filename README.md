# Asback Ticket

Discord.js v14 tabanli ticket botu ve Discord OAuth2 destekli web paneli.

## Ozellikler

- Butonlu ve secilebilir ticket olusturma
- Ticket kapatma, arsivleme ve transcript saklama
- Tek sunucuya odakli web panel
- Discord OAuth2 ile panel girisi
- Sunucu ayarlari ve ticket tiplerini panelden yonetme
- Log arsivi, transcript detaylari ve hata sayfalari

## GitHub Icin Hazir Yapi

- `config.json` takip edilen guvenli sablondur
- `config.local.json` yerel gizli ayarlar icindir ve `.gitignore` ile disarida tutulur
- `storage/` ve `croxydb/` runtime verileri git'e dahil edilmez
- `config.example.json` yeni kurulumlar icin ornek dosyadir

## Kurulum

1. Paketleri kurun:

```bash
npm install
```

2. `config.example.json` dosyasini referans alip `config.local.json` olusturun.

3. Su alanlari doldurun:

```json
{
  "token": "Discord bot tokeni",
  "DeveloperID": "Developer Discord user id",
  "panel": {
    "primaryGuildId": "Panelde duzenlenecek tek sunucu id",
    "sessionSecret": "Uzun rastgele session secret",
    "discordAuth": {
      "enabled": true,
      "clientSecret": "Discord OAuth2 client secret",
      "adminUserIds": ["Panel yoneticisi Discord user id"]
    }
  }
}
```

4. Discord Developer Portal tarafinda sunlari ayarlayin:

- `MESSAGE CONTENT INTENT` acik olsun
- Redirect URL olarak `http://127.0.0.1:3001/auth/discord/callback` ekleyin

5. Botu baslatin:

```bash
npm start
```

## Panel

- Varsayilan adres: `http://127.0.0.1:3001`
- Panel auth ayari yoksa web panel bilincli olarak baslamaz
- Tek sunucu modu `panel.primaryGuildId` ile sabitlenir
- Discord OAuth2 tercih edilir; gerekirse `panel.username` ve `panel.password` ile yedek giris acilabilir

## Dizinler

- `storage/transcripts/`: HTML transcript ciktilari
- `storage/ticket-logs.json`: panel log kayitlari
- `storage/panel-state.json`: acik ticket panel durumu
- `croxydb/croxydb.json`: legacy ticket ayarlari

## Guvenlik Notu

Bu projede daha once gercek token ve OAuth secret kullanildiysa, GitHub'a acmadan once Discord bot tokeninizi ve OAuth2 `client secret` degerinizi dondurun.
