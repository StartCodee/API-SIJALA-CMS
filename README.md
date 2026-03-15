# SIJALA-CMS-BE

Backend API untuk integrasi FE `sijala_cms` dan BE `SIJALA-CMS-BE`.

## Stack

- Node.js + JS
- Express
- PostgreSQL (`pg`)
- SSO via OIDC

## Migration

Migration ada di folder migration/mig.sql

## Auth

Backend ini sekarang mengikuti pola auth yang sama seperti dashboard patroli web:

- Login browser diarahkan ke SSO melalui `GET /api/auth/sso/start`
- FE menyelesaikan code exchange di `POST /api/auth/sso/exchange`
- Access token dikirim ke frontend dan hanya disimpan di memori
- Refresh token dijaga lewat cookie `HttpOnly` di backend
- Endpoint konten CMS (`/api/berita`, `/api/publikasi`, `/api/kegiatan`) sekarang memerlukan bearer token

Endpoint auth utama:

- `GET /api/auth/sso/login-url`
- `GET /api/auth/sso/start`
- `GET /api/auth/sso/logout-url`
- `POST /api/auth/sso/exchange`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

## API BERITA
- [GET] localhost:4100/api/berita
- [POST] localhost:4100/api/berita
request :
{
    "title": "berita Leo",
    "author": "Leo TEST",
    "category": "RISET",
    "status": "draft",
    "subjudul":"TEST Berita Leo",
    "date": "2026-03-22",
    "thumbnail": "leo.jpeg",
    "content": "TEST123"

}
- [PATCH] localhost:4100/api/berita/:id
- [DELETE] localhost:4100/api/berita/:id

## API PUBLIKASI
- [GET] localhost:4100/api/publikasi
- [POST] localhost:4100/api/publikasi
request :
{
    "title": "publikasi Leo2",
    "author": "Leo TEST",
    "category": "RISET",
    "status": "draft",
    "subjudul":"TEST Publikasi Leo",
    "date": "2026-03-22",
    "thumbnail": "leo.jpeg",
    "content": "TEST123",
    "pdf":"leo.pdf"

}
- [PATCH] localhost:4100/api/publikasi/:id
- [DELETE] localhost:4100/api/publikasi/:id

## API KALENDER KEGIATAN
- [GET] localhost:4100/api/kegiatan
- [POST] localhost:4100/api/kegiatan
request :
{
    "title": "Kegiatan Leo2",
    "location": "Sorong",
    "date": "2026-03-22",
    "time": "09:30",
    "category": "RISET",
    "image": "juice.jpg",
    "summary": "TEST",
    "description": "ABC123567980"
}
- [PATCH] localhost:4100/api/kegiatan/:id
- [DELETE] localhost:4100/api/kegiatan/:id
