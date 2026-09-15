# ADR-0002: Contrato same-site de cookie de sesión para el hotfix de login

**Estado:** Propuesto — pendiente de aprobación del TL.

## Contexto

El síntoma reportado era que un login exitoso volvía a mostrar la pantalla de login
al acceder o recargar una ruta protegida. La causa se reprodujo localmente: la cookie
de sesión emitida con `Path=/auth` no acompaña endpoints protegidos fuera de ese
prefijo. Con la misma sesión simulada, `Path=/auth` produjo `401` en el endpoint
protegido y `Path=/` produjo `200`.

El hotfix se limita al alcance de la cookie y al recorrido same-site del navegador.
No incorpora el ciclo de vida de sesión, `AuthProvider` ni la serialización de
login/logout de NUT-28; tampoco incorpora NUT-23 ni NUT-31.

## Decisión

- El login emite únicamente la cookie `token` vigente con `Path=/`.
- El logout expira la cookie `token` tanto en `Path=/` como en el alcance heredado
  `Path=/auth`, sin modificar otras cookies. Ambos borrados conservan los atributos
  de seguridad aplicables.
- La cookie mantiene `HttpOnly` y `SameSite=Strict`. `Secure` se habilita cuando
  `NODE_ENV=production`; el entorno local HTTP no lo habilita.
- Fuera de desarrollo, el cliente web usa la base relativa `/api` para login y
  solicitudes autenticadas. El rewrite de Vercel reenvía `/api/:path*` al backend
  antes del fallback SPA. En desarrollo se conserva `VITE_API_URL` hacia el backend
  local configurado.

No hay cambios de Prisma, datos, migraciones, autorización del backend ni contratos
de dominio distintos de este alcance de cookie y la ruta visible de API.

## Alternativas consideradas

1. **Mantener `Path=/auth`.** Descartada: la evidencia causal muestra que no cubre
   solicitudes protegidas fuera de `/auth`.
2. **Usar `Path=/` sin limpiar `/auth`.** Descartada: deja una cookie heredada del
   mismo nombre y host que puede seguir estando presente en navegadores existentes.
3. **Relajar `SameSite` o quitar `HttpOnly`.** Descartada: reduce protección sin
   corregir el alcance de ruta.
4. **Usar un origen API distinto en producción.** Descartada para este hotfix:
   contradice la estrategia same-site necesaria para sostener `SameSite=Strict`.
5. **Borrar desde el host web cookies host-only emitidas por otro host.** Fuera de
   alcance: el navegador impide a un host borrar cookies host-only de otro host.
6. **Inventar infraestructura aislada para Preview.** Descartada: requiere una
   decisión operativa y aprobación separadas.

## Consecuencias y riesgos

La cookie pasa a acompañar todas las rutas del mismo host, no sólo `/auth`. La
mitigación es conservar `HttpOnly`, `SameSite=Strict`, `Secure` según ambiente y la
autorización de cada endpoint en NestJS.

La doble expiración permite retirar el alcance heredado `/auth` del mismo host. No
puede retirar una cookie host-only antigua emitida directamente por otro host, por
ejemplo el backend histórico. Esa limitación no impide el flujo actual same-site
`/api`, pero una revocación cross-host requeriría una decisión y autorización
separadas.

El rewrite anterior al fallback SPA pasa a ser una dependencia operativa del flujo
desplegado: cambiar el orden puede enviar `/api` a `index.html` y romper login o
solicitudes protegidas. La implementación no cambia configuración de Vercel fuera
del rewrite versionado en este hotfix.

## Preview y entornos

La validación obligatoria se realizó contra backend y base locales aislados. Preview
no cuenta todavía con un backend aislado aprobado; no se afirma que Preview haya sido
validado, no se validó contra producción y no se modificó infraestructura de Vercel.
La definición y aprobación de un backend aislado para Preview siguen como pendiente
operativo. Esa pendiente no bloquea la evidencia local de este hotfix salvo que el
workflow del repositorio establezca expresamente lo contrario.

## Evidencia local real

En PostgreSQL 16 aislado en `127.0.0.1:55432`, con migraciones oficiales y seed
aplicados, se ejecutaron NestJS y el frontend locales. Sin registrar ni exponer el
token, el flujo HTTP produjo:

- login válido `200`, endpoint protegido `200` y refresh `200`;
- logout `204` y endpoint protegido posterior `401`;
- credenciales inválidas `401`, re-login `200` y endpoint protegido posterior `200`;
- login emitió sólo el alcance vigente con `HttpOnly`, `SameSite=Strict` y `Path=/`;
  `Secure` fue condicionado por ambiente;
- logout expiró `Path=/` y también `Path=/auth` con los atributos de seguridad
  aplicables;
- la reproducción de causa raíz mantuvo `Path=/` -> `200` y `Path=/auth` -> `401`.

La automatización existente cubre el controlador de autenticación y ambos alcances
de logout, la configuración same-site del cliente, el login web y el orden del
rewrite. Las suites completa API y web, lint/typecheck web, build web y
`git diff --check` son parte de la validación posterior requerida por este ADR.

El lint/typecheck API puede fallar exclusivamente por la deuda preexistente
`TS5103` de `apps/api/tsconfig.json` relacionada con `ignoreDeprecations`; no se
corrige dentro de este hotfix si continúa siendo el único error.

## Rollback

Si fuera necesario revertir, se debe revertir como una unidad revisada el alcance
`Path=/`, la expiración legacy `/auth` y la ruta/rewrite same-site, para no dejar
estrategias incompatibles. El rollback no debe intentar alterar cookies de otros
hosts. Ejecutarlo, modificar Preview o cambiar el contrato más allá de este hotfix
requiere aprobación humana.

## Aprobación pendiente

Esta ADR está propuesta y requiere aprobación del TL antes de considerar aprobado el
contrato material de autenticación. No se registra ninguna aprobación todavía.
