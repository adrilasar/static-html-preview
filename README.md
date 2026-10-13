# Static HTML Preview para VSCodium

Visor personal de HTML/CSS estático para archivos `.html` y `.htm`, locales o
abiertos mediante SSH. Abre la previsualización en una pestaña del editor y
permite volver al código con **Reopen Editor With… → Text Editor**.

## Instalar

1. Descarga `html-preview-codium-0.1.0.vsix` en tu ordenador Windows.
2. En VSCodium abre la paleta (`Ctrl+Shift+P`) y ejecuta
   **Extensions: Install from VSIX…**. Selecciona el archivo y recarga la ventana
   si VSCodium lo solicita.
3. Para proyectos SSH, conecta al servidor y asegúrate de que la extensión está
   instalada en **SSH: tu-servidor**. Puedes repetir **Install from VSIX…** desde
   esa ventana o usar **Install in SSH…** si aparece en la ficha de la extensión.
   La extensión se ejecuta en el host del proyecto y usa `workspace.fs`.
4. Haz clic en un HTML del explorador. **Static HTML Preview** se registra como
   editor predeterminado. Una asociación previa puede tener preferencia: usa
   **Reopen Editor With… → Configure default editor… → Static HTML Preview**, o
   añade esto a tus ajustes:

   ```json
   "workbench.editorAssociations": {
     "*.html": "adrian.staticHtmlPreview",
     "*.htm": "adrian.staticHtmlPreview"
   }
   ```

Para editar: clic derecho en la pestaña → **Reopen Editor With… → Text Editor**.
Para volver: **Reopen Editor With… → Static HTML Preview**. También puedes abrir
el mismo archivo en dos grupos, uno como texto y otro como previsualización.

## Recursos y actualización

- HTML y CSS inline, `<style>` y `<link rel="stylesheet" href="…">`.
- CSS relativo al archivo HTML; `url(…)` y `@import` relativos a cada hoja CSS.
  Los imports simples y con condición de medios están soportados.
- Imágenes PNG, JPEG, GIF, WebP, AVIF, ICO y SVG **como archivos de imagen**.
- Fuentes WOFF, WOFF2, TTF y OTF con `@font-face`.
- El HTML se actualiza al modificar su documento, incluidos cambios sin guardar
  en otra vista. Los recursos se recargan al guardarlos o cuando el proveedor de
  archivos comunica un cambio. Cada recarga vuelve a leerlos, sin caché permanente.
- El directorio autorizado es la carpeta del workspace que contiene el HTML.
  Sin carpeta abierta, es el directorio del HTML. `../` funciona dentro de esa
  raíz; los recursos fuera de ella se bloquean. En un workspace con varias
  carpetas, cada carpeta es un límite independiente.

No hace falta navegador integrado, servidor HTTP, puerto ni conexión a Internet
para usar la extensión. Una sesión SSH necesita su conexión habitual al servidor.

## Seguridad y límites

El webview tiene scripts, formularios y comandos deshabilitados, y
`localResourceRoots: []`. No hay canal de mensajes desde el HTML al host. La CSP
permite únicamente estilos inline e imágenes/fuentes `data:` generadas por la
extensión. No autoriza dominios ni siquiera el origen de recursos del webview.

Los recursos se leen con `workspace.fs`, se comprueban dentro del proyecto y se
incorporan al documento. Se bloquean rutas absolutas, esquemas de URL, URLs de
Internet, rutas UNC y escapes del directorio. Se comprueba cada componente de la
ruta, incluidos los antecesores del proyecto, y se rechazan enlaces simbólicos
que el proveedor identifica. Esas comprobaciones consultan metadatos de los
antecesores; no leen su contenido. `workspace.fs` no ofrece una lectura atómica
con `no-follow`: se confía en que el proveedor informe correctamente los enlaces
y en que otro proceso no cambie las rutas entre la comprobación y la lectura.

Se reconstruye el HTML con una lista de elementos/atributos estáticos permitidos.
Se eliminan scripts, eventos, enlaces navegables, formularios, iframes, embeds,
`base`, metadatos del documento original, SVG inline y MathML. El SVG referenciado
por `<img>` se carga como imagen, sin ejecución de su código. CSS no analizable
y `image-set()` se descartan; la CSP bloquea cualquier carga que no se haya
incorporado. Las URLs `data:` aportadas por el documento también se bloquean.

No se soportan aplicaciones JavaScript, vídeos, rutas desde `/`, `srcset`,
imports CSS con `layer()`/`supports()`, controles de formulario ni enlaces
interactivos. La página usa un fondo blanco y tipografía inicial de navegador;
su CSS puede cambiarlos. Una recarga completa puede restablecer el desplazamiento.

Límites por previsualización: HTML de 1 MiB, 20.000 nodos, profundidad 256,
128 recursos, 8 MiB por recurso, 24 MiB de lecturas y presupuesto de procesamiento
y contenido incorporado de 32 MiB. Los imports CSS tienen profundidad máxima 16.
Los recursos bloqueados o ausentes producen una nota; los límites de documento
y de renderizado producen un mensaje en la vista.

No hay telemetría, peticiones HTTP, procesos secundarios, comandos del sistema,
servidores ni configuración que permita ejecutar JavaScript.

## Desarrollo y comprobaciones

Se requieren Node.js 22.14 o posterior y npm. Descargar las herramientas de
compilación requiere Internet; usar el VSIX ya instalado no lo requiere.

```sh
npm ci
npm test
npm run package
```

El VSIX contiene un único JavaScript empaquetado, manifiesto, documentación y
licencias. No instala dependencias en ejecución. Incluye los analizadores
[parse5](https://github.com/inikulin/parse5) y
[CSS Tree](https://github.com/csstree/csstree), con sus dependencias necesarias,
para evitar una limpieza frágil basada en expresiones regulares. Son dependencias
de desarrollo en el manifiesto porque el empaquetador las incorpora al bundle;
sus licencias están en `THIRD_PARTY_NOTICES.txt`. Solo se incluyen las funciones
de análisis, recorrido y generación de CSS Tree, sin su base de validación CSS.

`npm test` comprueba recursos locales, URI Windows y URI SSH simuladas, CSS,
imágenes y fuentes incorporadas, imports, rutas maliciosas, enlaces simbólicos,
HTML malformado, CSP, límites y actualización/disposición del editor.

Para pruebas con un editor real:

```sh
# Descarga VS Code oficial para pruebas; en Linux requiere pantalla o xvfb-run.
npm run test:editor

# Usa una instalación existente de VSCodium (en Linux).
HTML_PREVIEW_EDITOR=/ruta/a/codium npm run test:editor
```

La integración comprueba apertura predeterminada, cambio a código y vuelta,
documento compartido/guardado, recursos y enlaces simbólicos reales, y archivos
en un proveedor de filesystem virtual. No sustituye una sesión SSH real.

En esta entrega se han comprobado esos casos con VSCodium **1.140.06880** en
Linux. Chromium ha confirmado CSS inline/relativo, imágenes, una fuente WOFF2
real y bloqueo CSP de
scripts y recursos HTTPS. La sesión Windows + SSH queda pendiente de la siguiente
prueba manual; las pruebas de URI remotas y del filesystem virtual han pasado.

Prueba final en tu instalación:

1. Abre una carpeta local con un HTML que referencie un CSS y una imagen relativos.
   Comprueba la vista y cambia a **Text Editor** y vuelta.
2. Repite en una carpeta abierta por SSH, con la extensión instalada en ese host.
3. Abre texto y vista en grupos distintos: cambia el HTML y guarda el CSS.
   Comprueba ambas actualizaciones.
4. Si usas fuentes locales, añade un `@font-face` con un WOFF2 del proyecto.
   Un recurso HTTPS o fuera del proyecto debe quedar bloqueado.

## Decisión técnica y referencias

[`CustomTextEditorProvider`](https://code.visualstudio.com/api/extension-guides/custom-editors)
comparte el documento de texto, guardado y editor de código de VSCodium. El
registro `contributes.customEditors` con `priority: "default"` aporta el visor
predeterminado y la elección de editor. El
[ejemplo oficial](https://github.com/microsoft/vscode-extension-samples/tree/main/custom-editor-sample)
sirvió como referencia; no se copió su implementación.

La documentación de [webviews](https://code.visualstudio.com/api/extension-guides/webview)
describe CSP, `localResourceRoots` y `asWebviewUri`. Aquí se incorporan recursos
validados en vez de habilitar un origen de archivos: esto reduce los permisos
del webview y evita que el CSS original elija rutas que eludan la validación.
