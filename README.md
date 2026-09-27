# MaxHack MVP v1.0

Prototipo web estático de cuestionario interactivo para práctica de Hacking Ético.

## Archivos

- `index.html`: interfaz principal.
- `styles.css`: diseño visual.
- `app.js`: lógica del cuestionario.
- `preguntas.json`: banco de preguntas. Para crecer el banco, agrega nuevos objetos siguiendo la misma estructura.

## Probar en tu computador

No abras `index.html` con doble clic porque el navegador puede bloquear la lectura de `preguntas.json`.

### Opción 1: Python

Desde la carpeta del proyecto:

```bash
python -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

### Opción 2: Visual Studio Code

Instala la extensión **Live Server**, abre `index.html` y usa **Open with Live Server**.

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub, por ejemplo `maxhack`.
2. Sube estos cuatro archivos a la raíz del repositorio.
3. Ve a **Settings > Pages**.
4. En **Build and deployment**, selecciona **Deploy from a branch**.
5. Selecciona la rama `main` y la carpeta `/(root)`.
6. Guarda los cambios.
7. GitHub publicará la app en una URL similar a:
   `https://TU_USUARIO.github.io/maxhack/`

## Próxima versión sugerida

- Seleccionar número de preguntas.
- Filtrar por capítulo/tema/dificultad.
- Guardar progreso del usuario.
- Migrar `preguntas.json` a Supabase.
- Agregar login e historial.
