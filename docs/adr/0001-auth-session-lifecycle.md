# ADR-0001: Sesión web basada en cookie y restauración con `GET /auth/me`

**Estado:** Propuesto — pendiente de validación humana de producto y backend.

## Contexto

El backend expone `POST /auth/login`, `GET /auth/me` y `POST /auth/logout`.
El inicio de sesión devuelve el usuario seguro y configura una cookie `token` HttpOnly,
SameSite Strict, de veinticuatro horas. El guard JWT lee esa cookie; `GET /auth/me`
devuelve el usuario asociado al `sub` o responde 401. El cierre de sesión es 204 y
debe expirar la misma cookie con los mismos atributos de alcance y seguridad.

El cliente Axios usa `withCredentials`; no necesita ni debe leer, almacenar ni
persistir el JWT. La UI sí necesita distinguir una restauración inicial de una sesión
anónima para no mostrar una ruta protegida antes de conocer `GET /auth/me`.

En Vercel, el navegador usa una base relativa `/api`. Un rewrite del proyecto web
reenvía ese prefijo al backend, por lo que login, restauración y logout conservan un
origen visible único para la cookie Strict. Producción y Preview deben configurar
explícitamente `VITE_API_URL=/api`; desarrollo local conserva la URL de localhost.

## Decisión

- La única fuente persistente de autenticación es la cookie HttpOnly del servidor.
  El usuario de React vive sólo en memoria y se reconstruye con `GET /auth/me` al
  montar el proveedor.
- Las mutaciones de la cookie se serializan: un login concurrente comparte la misma
  promesa y un login solicitado mientras un logout está pendiente espera ese logout.
  No se usan demoras artificiales.
- El logout invalida localmente la intención de sesión y navega a `/login` de
  inmediato; cuando completa el request, un login posterior puede establecer una
  sesión nueva. Una respuesta tardía de login invalidada no reautentica la UI.
- Mientras se restaura la sesión, `/login` conserva la pantalla de Login con sus
  controles y acciones de autenticación deshabilitados. Una respuesta anónima los
  habilita; una respuesta autenticada redirige a la ruta de destino. No se renderiza
  transitoriamente contenido protegido.
- Los 401 y 403 de solicitudes protegidas disparan la invalidación local mediante el
  interceptor común. Los requests de login, logout y restauración se excluyen para
  no causar ciclos. El significado de un 403 de negocio que no represente sesión
  inválida queda pendiente de confirmación contractual del backend.
- Login y logout deben usar exactamente el mismo `path` de cookie (además de
  `httpOnly`, `secure` y `sameSite`) para que logout pueda retirar la credencial que
  login emitió.
- El despliegue web usa el proxy same-site `/api` antes del fallback SPA. No se
  relaja la cookie a `SameSite=None`: el requisito operativo es configurar
  `VITE_API_URL=/api` tanto en Producción como en Preview.

## Alternativas descartadas

- Guardar JWT, contraseña o un indicador de sesión en `localStorage`/`sessionStorage`:
  aumenta la exposición de secretos y duplica la fuente de verdad.
- Permitir login y logout en paralelo: deja resultados dependientes del orden de red
  y puede restaurar una sesión que el usuario ya cerró.
- Ocultar el login con una pantalla genérica durante `GET /auth/me`: pierde contexto
  y dificulta la accesibilidad de una ruta pública.
- Resolver carreras con `setTimeout`: no establece orden causal ni es verificable.

## Consecuencias y reversión

La aplicación mantiene la sesión sólo mientras el servidor conserva la cookie. El
proxy de Vercel evita que el navegador dependa de una llamada cross-site para el flujo
web desplegado; una configuración ausente de `VITE_API_URL=/api` en Producción o
Preview rompe ese supuesto y debe corregirse como incidente de despliegue. No hay
cambios de base de datos, migraciones ni persistencia de secretos. Si se cambia el
contrato de sesión, se puede reemplazar el adaptador `authService` y la política del
proveedor sin migrar datos de usuario.
