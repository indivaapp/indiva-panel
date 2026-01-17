# Vercel Proxy - İNDİVA Panel

OnuAl.com'dan güvenilir veri çekmek için serverless proxy.

## Kurulum

```bash
npm install -g vercel
cd vercel-proxy
npm install
vercel login
vercel --prod
```

## API Kullanımı

### Fırsat Listesi Çek
```
GET /api/scrape?action=list
```

### Ürün Detayları Çek
```
GET /api/scrape?action=detail&url=https://onual.com/fiyat/urun-adi-p-12345.html
```

## Yanıt Formatı

```json
{
  "success": true,
  "count": 25,
  "deals": [
    {
      "id": "12345",
      "title": "Ürün Adı",
      "price": 299,
      "source": "trendyol",
      "onualLink": "https://onual.com/...",
      "imageUrl": "https://..."
    }
  ]
}
```
