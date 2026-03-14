# SIJALA-CMS-BE

Backend API untuk integrasi FE `sijala_cms` dan BE `SIJALA-CMS-BE`.

## Stack

- Node.js + JS
- Express
- PostgreSQL (`pg`)

## Migration

Migration ada di folder migration/mig.sql

## API BERITA
- [GET] localhost:5000/api/berita
- [POST] localhost:5000/api/berita
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
- [PATCH] localhost:5000/api/berita/:id
- [DELETE] localhost:5000/api/berita/:id

## API PUBLIKASI
- [GET] localhost:5000/api/publikasi
- [POST] localhost:5000/api/publikasi
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
- [PATCH] localhost:5000/api/publikasi/:id
- [DELETE] localhost:5000/api/publikasi/:id

## API KALENDER KEGIATAN
- [GET] localhost:5000/api/kegiatan
- [POST] localhost:5000/api/kegiatan
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
- [PATCH] localhost:5000/api/kegiatan/:id
- [DELETE] localhost:5000/api/kegiatan/:id

