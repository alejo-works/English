# English

Mi plan de inglés americano y **English Deck**, la app de repaso de vocabulario con repetición espaciada (FSRS) que sustituye a Anki.

## Cómo funciona

```
data/vocab.csv ──push──▶ Cloudflare Pages compila ──▶ app en el móvil/PC ──▶ progreso en el dispositivo
```

1. Se añaden filas a `data/vocab.csv` (o `data/errors.csv`) y se hace push a `main`.
2. GitHub Actions valida los CSV (`validate.yml`). Si hay un error, el check sale en rojo.
3. Cloudflare Pages recompila la app: el prebuild convierte los CSV en `cards.json`.
4. La app se actualiza sola la próxima vez que la abres con conexión.
5. El progreso (fechas, estabilidad, aciertos) vive en el dispositivo (IndexedDB). En la fase 2 se sincronizará con Supabase y se exportará cada noche a `data/review_state.csv`.

## Estructura

```
data/
  vocab.csv          vocabulario (lo editamos Claude y yo)
  errors.csv         mis errores repetidos, se repasan como "corrige la frase"
app/                 la PWA (Vite + React + TypeScript + ts-fsrs)
  scripts/build-data.ts   prebuild: data/*.csv → public/cards.json
scripts/
  validate_csv.py    valida columnas, ids únicos y valores permitidos
.github/workflows/
  validate.yml       valida los CSV en cada push
```

## Añadir vocabulario

Una fila por tarjeta en `data/vocab.csv`. CSV estándar: separador coma, UTF-8, y **comillas dobles en cualquier campo que lleve una coma**.

| Columna | Obligatoria | Valores / ejemplo |
| --- | --- | --- |
| `id` | sí | slug único que no se cambia nunca: `follow-up-on` |
| `english` | sí | `follow up on` |
| `spanish` | sí | `hacer seguimiento de` |
| `example_en` | sí | frase completa |
| `example_es` | no | traducción de la frase |
| `type` | sí | `word`, `phrasal_verb`, `idiom`, `slang`, `collocation`, `chunk` |
| `area` | sí | `tech_ai`, `finance`, `business`, `daily`, `nyc` |
| `register` | sí | `formal`, `neutral`, `informal`, `slang` |
| `source` | no | `VOA`, `Brooklyn Nine-Nine`, `chat Vocabulario`… |
| `date_added` | sí | `YYYY-MM-DD` |
| `notes` | no | pronunciación US aproximada, matices |

Ejemplo:

```csv
circle-back,circle back (to),retomar (un tema) más tarde,"Let's circle back to this on Friday, OK?","Retomemos esto el viernes, ¿vale?",phrasal_verb,business,neutral,chat Vocabulario,2026-11-14,
```

`data/errors.csv` tiene `id, wrong, right, rule, category, date_added`. Categorías: `tense`, `preposition`, `word_order`, `vocab`, `pronunciation`, `grammar`, `article`, `spelling`.

Reglas importantes:

- **No cambies ni reutilices un `id`**: el progreso de la tarjeta va ligado a él. Si quieres corregir el texto de una tarjeta, edita las demás columnas y deja el `id`.
- Los `id` no se pueden repetir, tampoco entre `vocab.csv` y `errors.csv`.
- Si borras una fila, la tarjeta desaparece de la app (su progreso queda guardado por si vuelve).

Antes de hacer push puedes validar en local:

```bash
python scripts/validate_csv.py
```

### Desde un chat de estudio con Claude

- Al final de cada sesión Claude da las tarjetas como filas CSV con este esquema.
- Si la sesión tiene acceso de escritura al repo y digo **"sube a GitHub"**, Claude añade las filas a `data/vocab.csv` sin duplicar `id`, valida y hace commit en `main`.

## Usar la app

- **Hoy:** tarjetas pendientes, racha, repasadas hoy y previsión de mañana.
- **Repasar:** toca la tarjeta (o pulsa espacio) para girarla y valora con Again / Hard / Good / Easy. Cada botón muestra cuándo volverá la tarjeta.
  - Teclado: `espacio` gira, `1`–`4` valora, `Enter` = Good, `Z` deshace, `S` pronuncia.
  - Móvil: toca para girar; con la tarjeta girada, desliza → Good y ← Again.
  - Modos `EN → ES` y `ES → EN`. El altavoz lee la palabra o el ejemplo con voz en-US.
  - Las tarjetas `slang` e `informal` llevan un aviso para no usarlas con clientes.
- **Biblioteca:** búsqueda y filtros por tipo, área, registro, fuente y estado.
- **Ajustes:** tema, nuevas por día (20 por defecto), retención objetivo (90 %), voz, incluir errores, exportar/importar copia.

> El progreso se guarda **solo en ese dispositivo** hasta la fase 2. Exporta una copia JSON de vez en cuando (Ajustes → Exportar copia). Para pasar el progreso del móvil al PC: exportar en uno, importar en el otro.

### Instalarla

- **Android:** abre la web en Chrome → menú ⋮ → *Instalar app*.
- **iPhone:** abre la web en Safari → Compartir → *Añadir a pantalla de inicio*.
- **PC:** en Chrome o Edge, icono de instalar en la barra de direcciones.

Funciona sin conexión una vez abierta por primera vez.

## Desarrollo

Requiere Node 22.

```bash
cd app
npm install
npm run dev       # genera cards.json y arranca en http://localhost:5173
npm test          # tests de la lógica de repaso
npm run build     # build de producción en app/dist
```

## Despliegue (Cloudflare Pages)

Conectado al repo con la integración de Git. Se publica en cada push a `main`.

| Ajuste | Valor |
| --- | --- |
| Framework preset | None |
| Production branch | `main` |
| Root directory | `app` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Variable de entorno | `NODE_VERSION` = `22` |

## Fases

- **Fase 1 (hecha):** CSV iniciales, validación, PWA offline con FSRS, Hoy, Repasar, Biblioteca, Ajustes y progreso en IndexedDB.
- **Fase 2:** Supabase (login por magic link, tablas `card_state` y `review_log` con RLS), sincronización móvil ↔ PC, `sync-progress.yml` nocturno → `data/review_state.csv` y `keepalive.yml` semanal.
- **Fase 3:** modos audio, dictado y cloze, estadísticas, sección Errores y exportador opcional a Anki.
