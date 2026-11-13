# English

Mi plan de inglés americano y **English Deck**, la app de repaso de vocabulario con repetición espaciada (FSRS) que sustituye a Anki.

## Cómo funciona

```
data/vocab.csv ──push──▶ Cloudflare compila ──▶ app en el móvil/PC ──▶ progreso en el dispositivo ⇄ Supabase
                                                                                        │ cada noche
                                                                     data/review_state.csv ◀┘
```

1. Se añaden filas a `data/vocab.csv` (o `data/errors.csv`) y se hace push a `main`.
2. GitHub Actions valida los CSV (`validate.yml`). Si hay un error, el check sale en rojo.
3. Cloudflare (Workers Builds) recompila la app: el prebuild convierte los CSV en `cards.json`.
4. La app se actualiza sola la próxima vez que la abres con conexión.
5. El progreso (fechas, estabilidad, aciertos) se guarda en el dispositivo (IndexedDB) y, con sesión iniciada, se sincroniza con Supabase. Funciona sin conexión: los repasos se suben al volver.
6. Cada noche una Action exporta el progreso a `data/review_state.csv` (generado, no se edita a mano).

## Estructura

```
data/
  vocab.csv          vocabulario (lo editamos Claude y yo)
  errors.csv         mis errores repetidos, se repasan como "corrige la frase"
  review_state.csv   GENERADO cada noche desde Supabase
app/                 la PWA (Vite + React + TypeScript + ts-fsrs)
  scripts/build-data.ts   prebuild: data/*.csv → public/cards.json
supabase/
  schema.sql         tablas card_state y review_log con RLS
scripts/
  validate_csv.py          valida columnas, ids únicos y valores permitidos
  export_review_state.py   Supabase → data/review_state.csv
.github/workflows/
  validate.yml       valida los CSV en cada push
  sync-progress.yml  cada noche: exporta el progreso
  keepalive.yml      lunes y jueves: consulta a Supabase para que no se pause
package.json, wrangler.jsonc   despliegue en Cloudflare Workers
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
  - Modos: `EN → ES`, `ES → EN`, **Oído** (suena la palabra y dices qué significa), **Dictado** (oyes el ejemplo y lo escribes; la app marca las diferencias) y **Cloze** (el ejemplo con la expresión tapada). El altavoz lee la palabra o el ejemplo con voz en-US.
  - Las tarjetas de error se responden escribiendo la frase corregida. Tras comprobar, el botón sugerido (Good / Hard / Again) sale marcado y `Enter` lo elige.
  - **Practicar mis errores** (en Hoy o en Biblioteca → Errores) abre un repaso solo con `errors.csv`.
  - Las tarjetas `slang` e `informal` llevan un aviso para no usarlas con clientes.
- **Biblioteca:** búsqueda y filtros por tipo, área, registro, fuente y estado.
- **Progreso:** retención real (30 días), aciertos, calendario de actividad, previsión de 14 días, estado del mazo, tarjetas que llevan X días sin verse y lo que más fallas.
- **Ajustes:** sincronización, tema, nuevas por día (20 por defecto), retención objetivo (90 %), voz, incluir errores, exportar/importar copia y **exportar a Anki** (.txt con tabuladores: en Anki, Archivo → Importar).

> **Sincronización:** Ajustes → Sincronización → email y contraseña. Hazlo en cada dispositivo. Si dos dispositivos repasan la misma tarjeta, gana el repaso más reciente; el historial guarda los dos. La copia JSON (Ajustes → Copia de seguridad) sigue disponible como respaldo extra.

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

## Despliegue (Cloudflare Workers)

Worker `english` conectado al repo (Workers Builds). Se publica en cada push a `main` en
https://english.alejottt1021.workers.dev.

| Ajuste | Valor |
| --- | --- |
| Root directory | `/` |
| Build command | `npm run build` (compila `app/`) |
| Deploy command | `npx wrangler deploy` (sube `app/dist` como assets, ver `wrangler.jsonc`) |
| Build variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

Las variables `VITE_*` se leen al compilar, así que van en **Build variables**, no en las variables del Worker. La anon key es pública por diseño; los datos los protege RLS.

## Supabase

1. SQL Editor → pegar `supabase/schema.sql` → Run.
2. Authentication → Users → **Add user → Create new user**: email + contraseña, marcando *Auto Confirm User*. Es el único usuario.
3. Authentication → Sign In / Providers → desactivar **Allow new users to sign up**.
4. Authentication → URL Configuration → Site URL: `https://english.alejottt1021.workers.dev`.

La app entra con email + contraseña (en iPhone, un enlace mágico abriría Safari y la sesión no llegaría a la app instalada). Queda como alternativa el código por email, que necesita SMTP propio para poner `{{ .Token }}` en la plantilla.
5. GitHub → Settings → Secrets and variables → Actions: `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` (service_role / secret key; nunca en la app).

## Fases

- **Fase 1 (hecha):** CSV iniciales, validación, PWA offline con FSRS, Hoy, Repasar, Biblioteca, Ajustes y progreso en IndexedDB.
- **Fase 2 (hecha):** Supabase (login con email y contraseña, `card_state` y `review_log` con RLS), sincronización local-first móvil ↔ PC, `sync-progress.yml` nocturno → `data/review_state.csv` y `keepalive.yml`.
- **Fase 3 (hecha):** modos Oído, Dictado y Cloze, pestaña Progreso, práctica de errores escribiendo y exportador a Anki.
