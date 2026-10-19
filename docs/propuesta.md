# Árbol: transición universitaria y detección temprana de abandono

Propuesta para la Hackatón EdTech · FCEIA-UNR

Oct 19, 2026 · @Fran

## Resumen ejecutivo

**El problema.** El primer año en la universidad está lleno de reglas nuevas (correlatividades, regularidad, mesas) y de exámenes cuyo estilo nadie conoce hasta que los rinde. Cuando un estudiante se traba en una materia que destraba muchas otras, el atraso se multiplica, y muchas veces nadie lo nota hasta que ya dejó.

**La solución.** *Árbol* es una app que convierte el plan de estudios real de cada carrera de la FCEIA en un árbol vivo. Combina cuatro piezas: el árbol como forma de seguir el progreso y detectar inactividad, un motor que identifica las materias cuello de botella y las señales tempranas de atraso, un tutor IA que prepara al alumno con parciales reales de años anteriores, y un armador de horarios que sugiere cómo cursar sin superposiciones.

**Por qué funciona.**

- **Se apoya en datos reales**: la FCEIA API trae 617 materias de 12 carreras con sus correlatividades, 944 exámenes (939 con texto) y 3249 materiales de estudio.
- **La señal de riesgo sale del propio uso**: si el alumno deja de entrar, el árbol se marchita, y eso mismo dispara una intervención concreta y escalonada.
- **No castiga al que vuelve**: el árbol se marchita pero no muere, y las materias aprobadas nunca se pierden.
- **Ayuda de verdad, no solo avisa**: la intervención es una propuesta de estudio concreta sobre el próximo parcial, no un genérico "volvé".

## 1. El desafío

> ¿Cómo podemos facilitar la transición a la universidad y detectar tempranamente las dificultades que pueden llevar a un estudiante a abandonar o atrasarse?

Nuestra respuesta ataca las dos mitades: para la transición, que el ingresante entienda cómo funciona la facultad y llegue al primer parcial sabiendo qué le van a tomar; para la detección, que la app note a tiempo cuando alguien se desengancha o se traba en una materia clave.

## 2. Fuente de datos: FCEIA API

Usamos la [FCEIA API](https://fceia-api.ariloc.ar/docs), pública, de solo lectura y sin autenticación. Reúne datos de la FCEIA-UNR extraídos de fuentes públicas, con curación híbrida (IA + revisión manual).

| Recurso | Cantidad | Para qué lo usamos |
| --- | --- | --- |
| Exámenes (parciales, finales, coloquios, quizzes) | 944, de los cuales 939 tienen el texto extraído (con LaTeX) | Práctica con exámenes reales y temas frecuentes |
| Materiales de estudio | 3249, de los cuales 2415 tienen texto | Base de conocimiento del tutor (RAG) |
| Resoluciones de exámenes | 73 | Respuesta de referencia |
| Materias + correlatividades | 617 materias, 12 carreras | Grafo del plan de estudios |
| Horarios de cursado | 1053 clases | Carga horaria y superposiciones |
| Bibliografía (con ISBN) | 613 | Recomendación de libros |
| Calendario / mesas de examen | 7 / 12 | Fechas clave |
| Tesinas / videos / proyectos de investigación | 410 / 116 / 132 | Orientación |

Cada examen trae una descripción con los temas evaluados (por ejemplo: "flujo máximo (Ford-Fulkerson); corte mínimo; número cromático…"). Así sabemos qué temas toma cada materia sin procesar nada.

**Limitación clave:** la API no tiene datos de estudiantes (notas, inscripciones, asistencia). Aporta el mapa del terreno; los datos del alumno los aporta nuestra app, con carga propia y check-ins.

> **A reforzar:** no queda claro qué cubren las 7 entradas de calendario y las 12 mesas (¿un solo año lectivo?, ¿todas las carreras?). Conviene aclararlo, porque varias alertas dependen de esas fechas.

## 3. La solución: cuatro piezas integradas

### 3.1 El Árbol: engagement y detección temprana

El árbol nace cuando el alumno crea la cuenta, y su estructura **es su plan de estudios real**, armado con las correlatividades de la API.

| Parte del árbol | Qué representa |
| --- | --- |
| Tronco | Materias cuello de botella |
| Ramas | Lo que se destraba al aprobar cada materia |
| Hojas | La actividad: check-ins y ejercicios practicados |
| Flores o frutos | Hitos: aprobar un final, aprobar un simulacro, cerrar un año |

**La inactividad es la señal de riesgo.** Si el alumno deja de entrar, el árbol se marchita, y ese mismo dato dispara la detección temprana.

**Diseño anti-abandono: el árbol se marchita, pero no muere.**

- Las ramas (materias aprobadas) nunca se pierden: el progreso real es permanente.
- Revive con una acción chica, como un check-in o un ejercicio. Volver tiene que ser fácil y gratificante.
- Clima según el calendario: en época de parciales o mesas el árbol necesita más agua, y en receso descansa sin penalizar.

Escalado gradual ante la inactividad:

| Días sin actividad | Qué pasa |
| --- | --- |
| 5 | El árbol se pone mustio y llega una notificación amable |
| 10 | Mensaje concreto: "se viene el parcial de Análisis I, ¿practicamos 1 ejercicio?" |
| 15 o más | Se ofrece contacto con un tutor o un par |

Por qué no muere: si el árbol muere, el alumno que se desengancha vuelve, ve que perdió todo y no regresa. Es el efecto contrario al buscado.

> **A reforzar:** los umbrales de 5, 10 y 15 días no tienen sustento en las notas. Conviene presentarlos como valores iniciales a calibrar. También falta definir qué cuenta como "actividad" (¿abrir la app alcanza?) y cómo se ajustan los umbrales en receso.

**Rachas que perdonan.** El árbol también cuenta rachas de actividad, pero diseñadas con la misma lógica anti-abandono:

- **Semanales, no diarias**: la racha suma por semanas con al menos una sesión de estudio. Una racha diaria castiga al que cursa, trabaja o tiene una semana pesada.
- **Respetan el calendario**: en receso la racha se congela sola, igual que el árbol descansa.
- **Comodines**: cada tanto el alumno gana un día o una semana de gracia que protege la racha.
- **La mejor racha queda**: si se corta, se muestra "tu mejor racha: 8 semanas" y no un cero. Volver arranca una racha nueva con un mensaje de bienvenida, no de reproche.
- **Ligadas a hitos**: llegar a ciertas rachas suma frutos al árbol, así el esfuerzo sostenido se ve en la planta.

Por qué así: una racha que se pierde de golpe produce el mismo efecto que un árbol muerto, el alumno ve que perdió todo y no vuelve. Y es justo el alumno con la racha cortada el que más necesitamos que regrese.

> **A reforzar:** el ejemplo de "8 semanas" es ilustrativo. Falta definir qué cuenta como sesión de estudio para la racha y cada cuánto se gana un comodín.

### 3.2 Detección de riesgo de atraso

**Materias cuello de botella.** Calculamos cuántas materias destraba cada una. Ejemplo real con Ciencias de la Computación:

| Materia | Destraba (directo) | Exámenes en la base |
| --- | --- | --- |
| Lógica | 6 | 10 |
| Estructuras de Datos y Algoritmos II | 5 | 46 |
| Suficiencia de Inglés | 5 | 77 |
| Análisis Matemático II | 3 | 9 |
| Álgebra Lineal | 3 | 24 |

Métrica principal: **cuánto se atrasa tu carrera si dejás esta materia**, medido sobre el camino crítico hasta recibirte.

> **A reforzar:** la tabla muestra solo correlatividades directas, y la métrica del camino crítico todavía no tiene un ejemplo calculado. Un número concreto ("dejar Lógica te atrasa N cuatrimestres") haría mucho más fuerte este punto frente al jurado.

**Señales tempranas** (datos del alumno cruzados con la API):

- No rindió el primer parcial de una materia que destraba mucho → alerta alta.
- Carga horaria irreal o superposición de horarios.
- Se acerca el cierre de inscripción a mesas y no se anotó.
- Acumula materias regulares sin rendir el final.
- Inactividad en la app (el árbol se marchita).
- Lo que dice en el chat ("no entiendo nada", "voy a dejar"), con consentimiento.

> **A reforzar:** varias señales dependen de que el alumno cargue sus propios datos (parciales rendidos, inscripciones), y la API no los tiene. Falta explicar cómo se incentiva esa carga y qué pasa si el alumno no la hace. Tampoco está definido cómo se combinan las señales en una alerta (pesos o reglas).

### 3.3 Tutor IA: chatbot + servidor MCP

Ejemplo de pedido: *"Preparame Análisis Matemático I para el parcial del 15/11"*.

1. **Diagnóstico**: ranking de los temas más tomados.
2. **Plan**: reparte los temas en los días que quedan, priorizando los más frecuentes.
3. **Práctica**: ejercicios de parciales reales de años anteriores, uno por uno.
4. **Corrección**: corrige respuestas escritas o en foto, da pistas antes que la solución y usa la resolución oficial cuando existe.
5. **Teoría**: busca en los apuntes de la materia y recomienda el capítulo del libro del programa.
6. **Simulacro**: parcial de práctica con el estilo de la cátedra y tiempo cronometrado.

**Tools del servidor MCP:**

| Tool | Endpoint de la API |
| --- | --- |
| `buscar_materia(nombre, carrera)` | `/subjects?q=` |
| `temas_frecuentes(materia)` | `/exams?subject_id=` (agrupa los temas de las descripciones) |
| `ejercicios(materia, tema, tipo)` | `/exams?subject_id=&text=` + `/exams/{id}/text` |
| `resolucion(examen)` | `/solutions?exam_id=` + `/text` |
| `buscar_apunte(materia, tema)` | `/materials?subject_id=&text=` + `/text` |
| `bibliografia(materia)` | `/subjects/{id}/bibliography` |
| `correlativas(materia)` | `/subjects/{id}/relations` |
| `fechas()` | `/calendar`, `/exam-boards` |
| `registrar_progreso` / `ver_mi_arbol` | Estado propio del alumno (no viene de la API) |

**Integración con el árbol:**

- Cada sesión de estudio riega el árbol.
- Cada tema dominado suma hojas a la rama de esa materia.
- Un simulacro aprobado le pone una flor: la materia está lista para rendir.
- Cuando el árbol se marchita, el chatbot es la intervención, con una propuesta concreta y no un genérico "volvé".

> **A reforzar:** las notas hablan de RAG sobre los apuntes, pero `buscar_apunte` usa la búsqueda por texto de la API. Conviene aclarar si hay embeddings propios o si "RAG" se refiere a esa búsqueda. Falta también definir qué significa "tema dominado" y "simulacro aprobado" (¿qué puntaje?).

### 3.4 Armador de horarios

El alumno carga las materias que quiere cursar y la app le sugiere una combinación de comisiones sin superposiciones. Usa los 1053 horarios de cursado de la API.

Cómo funciona:

1. **Carga**: el alumno elige las materias del cuatrimestre (la app solo ofrece las que puede cursar según sus correlatividades).
2. **Combinaciones**: para cada materia toma sus comisiones y busca las combinaciones donde ningún horario se pisa.
3. **Sugerencia**: ordena las opciones válidas y muestra la mejor como grilla semanal, con alternativas.
4. **Conflicto sin salida**: si no hay combinación posible, dice qué materias chocan y propone cuál conviene postergar, priorizando no dejar las cuello de botella.

Conexión con el resto:

- Alimenta la señal de "carga horaria irreal o superposición de horarios" de la sección 3.2: en vez de solo alertar, la app ofrece la solución.
- Para el ingresante, es parte del onboarding: arma su primer horario sin tener que cruzar planillas.
- Se suma como tool del MCP (`armar_horario(materias)`), así el alumno también puede pedirlo por chat.

> **A reforzar:** falta confirmar que la API distingue comisiones alternativas de una misma materia (sin eso no hay opciones para combinar) y si incluye la sede, para avisar de traslados entre clases seguidas. Tampoco está definido el criterio para elegir "la mejor" combinación: menos días en la facultad, menos huecos, turno preferido.

## 4. Transición del ingresante

- **Onboarding**: elegís tu carrera y ves tu plan como árbol, tu horario, la sede y las próximas fechas.
- **Glosario de primer año**: qué es correlatividad, regularidad, promoción y mesa.
- **"Sin sorpresas"**: cómo es realmente un parcial, con exámenes reales anteriores, y práctica antes del primer parcial, no después de reprobar.
- **Reorientación en vez de abandono**: qué otras carreras comparten las materias ya aprobadas.

> **A reforzar:** la reorientación es una idea potente para el desafío, pero las notas no dicen cómo se detecta que una materia es "la misma" en dos carreras (¿mismo código en la API?, ¿equivalencias oficiales?).

## 5. Vista institucional (tutores / escuela)

Los tutores y la escuela ven datos agregados y anónimos: qué materias generan más alertas, en qué semana del cuatrimestre aparecen y cuántos árboles se están marchitando. A futuro, la vista escala integrando datos de SIU Guaraní.

> **A reforzar:** falta un tamaño mínimo de grupo para que lo agregado siga siendo anónimo (en una comisión chica, "3 árboles marchitos" puede identificar a alguien). La integración con SIU Guaraní también requiere acuerdo con la facultad, y conviene decirlo.

## 6. Arquitectura

&#91;embedded content: arquitectura · app, backend, MCP y estado del alumno\]

El backend con Claude consulta la FCEIA API a través del servidor MCP (solo lectura) y guarda aparte el estado de cada alumno. El MCP es reutilizable: cualquier alumno puede conectarlo a su propio Claude.

> **A reforzar:** conectarlo "a su propio Claude" requiere un cliente con soporte MCP. Conviene aclarar si el servidor va a estar publicado y cómo se separa el estado de cada alumno en ese uso.

## 7. Demo

La demo muestra los dos caminos posibles con dos alumnos simulados:

- **Alumno A**: árbol frondoso. Practica Análisis I con el tutor y el árbol florece.
- **Alumno B**: dejó de entrar. El árbol se marchita y la rama de Lógica (cuello de botella) se seca. La intervención y la propuesta del tutor se disparan solas.

Usamos una carrera y materias con buena cobertura de exámenes: Análisis I (56), EDyA II (46) y Arquitectura del Computador (28).

> **A reforzar:** Lógica, la materia del Alumno B, tiene solo 10 exámenes en la base, bastante menos que las de cobertura buena. Si el tutor va a proponer práctica en esa rama durante la demo, conviene verificar antes que esos 10 alcancen.

## 8. Riesgos y cuidados

| Riesgo | Detalle | Cómo lo manejamos |
| --- | --- | --- |
| Calidad de datos | Solo el 77 % de las materias tiene año asignado, y algunos años están mal. Solo el 48 % de los exámenes tiene fecha. | Revisión manual del plan de la carrera de la demo |
| Pocas resoluciones | Hay 73 resoluciones para 944 exámenes | El tutor resuelve paso a paso y dice cuando no está seguro |
| Exámenes escaneados | Las figuras vienen descritas como texto | Mostrar también el PDF original (`file_url`) |
| Ética | Riesgo de etiquetar al alumno | Nada de "puntaje de abandono" visible: se muestran caminos y próximas acciones, no etiquetas. Consentimiento explícito para escalar señales a tutores humanos |
| Pedagogía | Que el tutor regale respuestas | Da pistas, no soluciones. Eso lo diferencia de "pegarlo en ChatGPT" |

> **A reforzar:** que solo el 48 % de los exámenes tenga fecha afecta a "temas frecuentes": sin fecha no se puede priorizar lo que se tomó en los últimos años. Conviene decir cómo se trata ese caso.

## 9. Próximos pasos

1. Servidor MCP sobre la API (unas 8 tools).
2. Árbol generado desde las correlatividades reales de una carrera.
3. Chat tutor integrado con el árbol.
4. Lógica de marchitamiento y alertas.
5. Datos simulados de dos alumnos para la demo.

6) Armador de horarios sobre los horarios de cursado de la API.

## 10. Puntos a reforzar antes de presentar

Además de las notas marcadas en cada sección, hay huecos que un jurado probablemente pregunte:

- **Métrica de éxito**: no hay una forma definida de medir si *Árbol* reduce el abandono o el atraso (por ejemplo, tasa de regreso tras una alerta, o proporción de alumnos que rinden el primer parcial).
- **Evidencia del diseño "no muere"**: el argumento de que un árbol muerto aleja al alumno es razonable, pero no cita evidencia. Se puede presentar como hipótesis de diseño o apoyarlo en literatura de gamificación.
- **Persistencia del alumno**: falta decidir entre SQLite y Supabase.
- **Privacidad del chat**: usar frases del chat como señal de riesgo requiere aclarar quién las lee, cómo se pide el consentimiento y qué se guarda.
- **Quién hace las intervenciones humanas**: el paso de los 15 días ofrece "un tutor o un par", pero no está definido de dónde salen esas personas.
- **Equipo y alcance de la hackatón**: no figura quién integra el equipo ni qué de los próximos pasos estará listo para la demo.

