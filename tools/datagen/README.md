# tools/datagen — Generador de datos ficticios

Dueña: Astrid. Genera 2,000 documentos ficticios y deterministas (semilla fija) más 100
modificaciones o despublicaciones, usando solo la librería estándar de Node y la API HTTP.

Requisitos: ESC4-10; prueba P4-1; condición 5.8.

## Uso

Con la API y el indexer corriendo:

```bash
BASE_URL=http://localhost:8080 EDITOR_TOKEN=dev-editor-token npm start -w tools/datagen
```

| Variable | Por defecto | Descripción |
|---|---|---|
| `BASE_URL` | `http://localhost:8080` | URL de la API |
| `EDITOR_TOKEN` | — (obligatoria) | Token ficticio con rol editor |
| `SEED` | `42` | Misma semilla → mismo conjunto de datos |
| `DOCS` | `2000` | Documentos a crear |
| `CHANGES` | `100` | Modificaciones (`PUT` con `If-Match`) y despublicaciones, alternadas |

Al terminar espera a que `GET /index/status` reporte `pending = 0` y escribe un resumen JSON
(`created, updated, unpublished, failures, pending, failed`). Sale con código 1 si hubo fallos
o el índice no convergió en 120 s.

## Prueba aislada

- `npm test -w tools/datagen`: verifica determinismo y que los datos cumplan los límites del contrato.
- Contra una API local: ejecutar el generador y comprobar con `GET /search?q=respaldo`.
