# 🔍 Análisis profundo — Uploader Grub (v1.7.4)

> Revisión de arquitectura, correctitud, edge cases y calidad de tests.
> Estado: ✅ 174 tests pasan · ✅ typecheck · ✅ lint · ✅ build

---

## 1. Resumen general

Bot de Discord en TypeScript (NodeNext, ESM, pnpm) que organiza, marca con
watermark y sube archivos de medios de carpetas locales a canales/threads de
Discord. Arquitectura limpia por capas:

```
index.ts (entrypoint, señales, flags)
 ├── config/loader.ts         → carga y valida config.json (+ $ENV)
 ├── setup/                   → crea carpetas, organiza archivos sueltos
 ├── core/
 │    ├── pipeline.ts         → orquesta: read → size-gate → watermark → send → cleanup
 │    ├── sender.ts           → envío con retries + dedup persistido
 │    ├── channel.ts          → resolve + reactivar threads archivados
 │    ├── imageProcessor.ts   → watermark sharp (concurrency limitada)
 │    ├── videoProcessor.ts   → ffmpeg CRF + audio copy, HW accel
 │    ├── gifProcessor.ts     → ffmpeg palettegen/paletteuse
 │    ├── heavyProcessor.ts   → modo --process-heavy (sin Discord)
 │    └── watcher.ts          → chokidar, debounce 3s, mutex + FIFO
 └── utils/                   → files, ffprobe, encoder, process, tracker, progress
```

Puntos fuertes destacables:

- **Calidad de vídeo "quality-first"**: CRF + `-c:a copy`, sin forzar bitrate.
  Fallback HW→SW y audio copy→AAC bien orquestado.
- **Robustez en errores**: ficheros corruptos → cuarentena `_failed/`, no
  reintentos infinitos; temp files registrados y limpiados en shutdown;
  kill del árbol de procesos (nice wrapper incluido).
- **Dedup persistido** (`<root>/.state/sent.log`) con escritura atómica
  (temp+rename) y bound de 2000 keys.
- **Watch mode** con mutex, cola FIFO y un único timer por root (sin leaks).
- **Tests de calidad**: 174 tests, los de sender/watcher/heavy son sólidos
  (fake timers, mocks, integración pesada de fs).

---

## 2. Hallazgos (bugs y problemas) por severidad

### 🔴 Medio — inconsistencia watch/normal cuando un `path` de config es el root

- `src/core/watcher.ts:40` → `config.filter((e) => e.path.startsWith(root + "/"))`
- Si un usuario configura un `path` que **es** el root (p.ej. `$HOME/vanilla` en
  vez de `$HOME/vanilla/videos`), en modo normal el pipeline lo procesa, pero en
  modo watch la entrada se filtra (`"/data/vanilla".startsWith("/data/vanilla/")`
  → `false`) y nunca se procesa.
- `extractRoot()` (`setup/index.ts:7`) devuelve el path tal cual si no termina
  en `images|videos|heavy`, así que el root coincide con el path → caso real.
- **Sugerencia**: filtrar con `e.path === root || e.path.startsWith(root + "/")`.

### 🔴 Medio — fallback de vídeo puede maldiagnosticar y hacer un retry inútil

- `src/core/videoProcessor.ts:174-195`
- Cuando el intento HW falla, se reintenta con libx264 "copy". Si ese segundo
  intento falla por un problema **de vídeo** (píxel format/input no soportado),
  se loguea `"audio copy failed"` y se reintenta con `-c:a aac`… que vuelve a
  fallar por la misma razón. El error final es confuso y el retry es desperdiciado.
- **Sugerencia**: distinguir el error de audio del de vídeo, o simplemente
  refinar el mensaje ("encode failed, retrying with AAC fallback").

### 🟡 Bajo — EXIF orientation ignorada en imágenes

- `src/core/imageProcessor.ts:15-64` — `sharp().metadata()` no aplica rotación
  EXIF. Una imagen con orientación 6/8 se compone sobre los píxeles crudos; el
  watermark queda en una posición distinta a la imagen que muestra Discord, y el
  archivo saliente conserva la orientación EXIF (algunos visores rotan, otros no).
- **Sugerencia**: leer `metadata.orientation` y componer tras `.rotate()` /
  `.withMetadata()`.

### 🟡 Bajo — `VAAPI_DEVICE` hardcodeado

- `src/utils/encoder.ts:25,244` — `/dev/dri/renderD128` fijo. En hosts con
  `renderD129` (segunda GPU / configuración distinta) vaapi se descarta
  silenciosamente aunque funcione.
- **Sugerencia**: probar `renderD128` y `renderD129`, o aceptar una env var.

### 🟡 Bajo — `expandEnvVars` falla en silencio

- `src/utils/env.ts:1-9` — una variable mal escrita (`$HOM`) se expande a `""`
  sin advertencia; la ruta resultante (`/vanilla/videos`) existe como carpeta
  relativa y puede crear árboles en sitios inesperados.
- **Sugerencia**: loguear un warning cuando la var no existe en `process.env`.

### 🟡 Bajo — `_SKIPPED_` se crea en el padre del path configurado

- `src/core/pipeline.ts:180-183` — los archivos no soportados se mueven a
  `join(dirname(path), "_SKIPPED_" + fileName)`. Si `path` es el root, `dirname`
  es el padre del árbol de medios. Coherente con sent/heavy (mismo nivel que el
  root), pero si el `path` NO es subcarpeta (caso del hallazgo 1) el destino
  queda fuera del árbol.
- Menor, pero conviene unificar: usar el root real (`getUniqueRoots`) como base.

### 🟡 Bajo — re-encode repetido en bucle para archivos con dedup "duplicate"

- `src/core/pipeline.ts:196-224` — si `sendFile` devuelve `reason: "duplicate"`
  (sesión anterior persistida + limpieza fallida), el temp se borra pero el
  original **no** se mueve/elimina. En `--watch`, cada evento del root re-hace
  el watermark del archivo (CPU/tiempo) aunque nunca se re-envíe.
- **Sugerencia**: si `result.reason === "duplicate"`, tratar el original como
  sent (borrar/mover a sent/) igual que en éxito.

### 🟡 Bajo — persistencia del registry con filenames con `\n`

- `src/core/sender.ts:55-66` — `[...sentFiles].join("\n")` línea-por-línea.
  Un nombre de archivo con salto de línea corrompe el formato (varias keys en
  una línea). Extremadamente raro, pero trivial de arreglar (escapar).

### 🟡 Bajo — escritura sincrónica del registry en cada envío

- `src/core/sender.ts:60-61` — `writeFileSync` + `renameSync` en cada
  `markAsSent`. Con 500 archivos → 500 fsync bloqueantes. Aceptable para este
  volumen, pero un batch/backpressure no iría de más.

### 🟢 Informacional — código duplicado y cosmética

- `killTree` (`process.ts:56`) y `signalProcessTree` (`processTracker.ts:18`)
  son idénticos → QA.
- Mensaje "Connected to ${channel.name}" en `channel.ts` usa `name` no tipado
  por el tipo de union → en DMs sería `null`; irrelevante (los DM se rechazan
  antes). Trivial.

### 🟢 Informacional — `config.example.json` con nombres explícitos NSFW

- `config.example.json:6-7` (`anal`, `blowjob`) — no es un bug, pero para un
  repositorio público/compartible unos ejemplos neutros serían más adecuados.

---

## 3. Verificación de flujos clave (correctitud)

| Flujo                                                                        | Resultado                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------- |
| Happy path imagen/vídeo/GIF con watermark                                    | ✅ watermark → send → delete original       |
| Size gate pre-encode (`> MAX_FILE_SIZE` → heavy/)                            | ✅ `pipeline.ts:144`                        |
| Size gate post-encode (`too_large` → heavy/)                                 | ✅ `sender.ts:141` + `pipeline.ts:222`      |
| `.3gp` con `--skip-watermark` → convierte a `.mp4` sin logo                  | ✅ con guard de ffmpeg lazy (no cuarentena) |
| Avif/bmp/tiff → `.jpg` al watermarkear                                       | ✅ `getOutputExtension` + sharp             |
| Archivo corrupto → `_failed/` (no reintento infinito)                        | ✅ ambos pipelines                          |
| Retry Discord: 429/5xx/red → backoff con jitter; 4xx permanente → fail fast  | ✅ `sender.ts:83-111`                       |
| Dedup `channelId:fileName` + persistencia atómica + evicción 2000            | ✅ con edge cases arriba                    |
| Shutdown: SIGINT/SIGTERM → kill ffmpeg tree → limpiar temps → destroy client | ✅                                          |
| unhandledRejection → log y sigue (clave en watch largo)                      | ✅ `index.ts:50`                            |
| uncaughtException → cleanup + exit                                           | ✅ `index.ts:57`                            |
| Watch: mutex + FIFO + debounce 3s + timer único por root                     | ✅ tests cubren cola                        |
| Heavy: promover si cabe, reemplazar en heavy/ si no, nunca clobber           | ✅ `heavyProcessor.ts:124-159`              |
| `--process-heavy` + `--watch` mutuamente exclusivos                          | ✅ `index.ts:95`                            |
| Move cross-device (EXDEV) → copy+delete                                      | ✅ `files.ts:136`                           |
| `nice -n 10` (Linux, `VIDEO_NICE=1`) y kill del grupo del wrapper            | ✅                                          |
| Encoder HW: validación real (micro-encode + `-encoders` + render node)       | ✅ bien hecha                               |
| Timeout ffmpeg escalado con duración, cap 6h                                 | ✅ vídeo y GIF                              |

---

## 4. Tests — cobertura

**174 tests, 15 ficheros — todos pasan.** Suite rápida (1.2s).

Cobertura global: **56.32% statements / 50.77% branches** (v8).

| Área                                                                                        | Stmts     | Comentario                                               |
| ------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------- |
| `sender.ts`                                                                                 | 88%       | excelente: retries, 429, retryAfter, dedup, persistencia |
| `heavyProcessor.ts`                                                                         | 87%       | excelente: skip/watermark, 3gp, size gates, cuarentena   |
| `watcher.ts`                                                                                | 87%       | buena: cola FIFO, mutex, dotfiles, debounce              |
| `files.ts` / `organizer.ts` / `process.ts`                                                  | 74-85%    | buenas                                                   |
| `pipeline.ts`                                                                               | 52%       | media — los path de watermark real están mockeados       |
| `index.ts`, `client.ts`, `folderManager.ts`                                                 | 0%        | entrypoint sin tests (aceptable, es glue)                |
| **`videoProcessor.ts`, `gifProcessor.ts`, `encoder.ts`, `ffprobe.ts`, `imageProcessor.ts`** | **0-10%** | 🔴 **el corazón del watermarking NO tiene tests**        |

**Riesgo principal de cobertura**: la lógica más compleja y propensa a regresión
(el encode ffmpeg, la selección/validación de encoder HW, el parseo de
`-progress` y los fallbacks de audio) no está cubierta. Un test de integración
opcional con ffmpeg real (o los fallbacks unitarios con el stdout simulado de
`runCommand` mockeado) cerraría el mayor hueco.

---

## 5. Notas de seguridad (resumen — delegar al agente security)

- Sin secretos commiteados: `.env` y `config.json` en `.gitignore` ✅
- Token se lee de env, nunca se loguea ✅
- Nada de eval/exec de entrada del usuario; ffmpeg se invoca con args fijos
  (los nombres de archivo pasan como args, no por shell) ✅
- Paths derivados de config sin sanitizar más allá de validar `string` — un
  `path` absoluto arbitrario es "feature" (el usuario es el dueño del bot) ⚠️
- **Se recomienda** ejecutar el agente security para escaneo de dependencias
  (discord.js/sharp/chokidar) y revisar el manejo del `child_process`.

---

## 6. Verdict

**approve con nits.** El código es correcto, robusto y muy bien probado para su
tamaño. Los hallazgos de severidad media (inconsistencia watch cuando el path es
el root, y el fallback de vídeo con diagnóstico confuso) merecen un vistazo;
el resto son mejoras menores.

## 7. Siguientes pasos

- Ejecutar **agente QA** para lint/format/estática (el código ya pasa `eslint`
  y `prettier --check`, revisar código duplicado).
- Ejecutar **agente Security** para dependencias y `child_process`.
- Considerar tests para `videoProcessor`/`encoder`/`imageProcessor`.
