# Cuellos de botella y camino crítico

Issue #3. Código en `backend/internal/plan`; resultado en `backend/data/plan_career_1.json` (Licenciatura en Ciencias de la Computación), con la forma de `contratos.md` §2.1. Se calcula sobre las correlativas **ya revisadas** contra las fuentes oficiales (`revision-plan-lcc.md`).

## Modelo

- Cada materia ocupa **un cuatrimestre**, sin límite de materias por cuatrimestre, y arranca el cuatrimestre siguiente a que se aprueban todas sus correlativas. Es un **piso optimista**: nadie se recibe en menos.
- El grafo base son las **obligatorias** (34: las 31 asignaturas, Tesina incluida, más Optativa I, II y III) con las correlativas de la API más las correcciones de `corrections/`, reducidas a las **directas** (ver `revision-plan-lcc.md`). Las **electivas** son nodos opcionales: no cuentan en el plan base y se suman al camino crítico solo cuando el alumno las elige (`Result.Analyze`).
- La **Tesina** es una materia más: depende de todas las obligatorias y las optativas, así que cierra el camino crítico.
- Las materias se dictan una vez al año, así que **"dejar" una materia es posponerla un año (2 cuatrimestres)**.
- El campo `year` de la API tiene errores y no se usa para calcular nada: todo sale de las correlativas.

| Métrica | Definición |
|---|---|
| `unlocks` | Materias que la requieren directamente |
| `unlocks_total` | Directas + indirectas |
| `bottleneck` | `unlocks_total >= 8` |
| `slack` | Cuatrimestres que se puede demorar sin atrasar la carrera; 0 = camino crítico |
| `postpone_year_delay` | Cuatrimestres que se atrasa la carrera si la materia se pospone un año |
| `min_terms` / `critical_path` | Largo y cadena de la ruta más larga (desempate por menor `subject_id`) |

## Resultado para LCC

La carrera lleva **9 cuatrimestres como mínimo** (el plan oficial pone 10). Camino crítico: Álgebra I → Álgebra II → Álgebra Lineal → Complementos de Matemática I → EDA II → Teoría de Base de Datos → Introducción a la Inteligencia Artificial → Práctica Profesional → Tesina. Práctica Profesional y Taller de Tesina empatan en el anteúltimo lugar; el desempate elige la de menor `subject_id`.

| Materia | Destraba (directo) | Destraba (total) | Holgura | Atraso si se pospone un año |
|---|---|---|---|---|
| Programación I | 1 | 21 | 0 | 2 |
| Programación II | 3 | 20 | 0 | 2 |
| Álgebra y Geometría Analítica I | 1 | 16 | 0 | 2 |
| Álgebra y Geometría Analítica II | 1 | 15 | 0 | 2 |
| Estructuras de Datos y Algoritmos I | 2 | 15 | 0 | 2 |
| Álgebra Lineal | 3 | 14 | 0 | 2 |
| **Lógica** | 5 | **13** | 2 | **0** |
| Complementos de Matemática I | 1 | 11 | 0 | 2 |
| Estructuras de Datos y Algoritmos II | 3 | 10 | 0 | 2 |
| Examen de Suficiencia de Inglés | 5 | 10 | 4 | 0 |
| Análisis Matemático I | 1 | 8 | 3 | 0 |

Cuellos de botella (`unlocks_total >= 8`), 11: Programación I y II, Álgebra I y II, Álgebra Lineal, EDA I y II, Complementos I, Lógica, Inglés y Análisis I. Con Práctica Profesional, Taller de Tesina y Tesina en el grafo, casi todas las materias destraban entre 1 y 3 más que antes; eso sumó EDA II, Inglés y Análisis I. El umbral se mantuvo en 8 (issue #33).

**Para el pitch**
- "De las 34 obligatorias, **13 dependen de Lógica**." Es el número fuerte para Lógica.
- Postergar Lógica **no atrasa** la carrera (holgura 2): lo que pierde el alumno es que quedan trabadas 13 materias, no cuatrimestres. No conviene decir "dejar Lógica te atrasa N cuatrimestres".
- Las que sí atrasan **2 cuatrimestres** si se posponen un año son 15, entre ellas Programación I y II, Álgebra I y II, Álgebra Lineal, EDA I y II y Complementos I. Programación I y II son las que más destraban (21 y 20).
- Suficiencia de Inglés y Análisis I son cuello de botella por cantidad (destraban 10 y 8), pero tienen holgura (4 y 3): postergarlas un año no atrasa la carrera.

## Límites
- Piso optimista: no modela cuántas materias entran en un cuatrimestre, ni que se dicten solo en su cuatrimestre.
- Las correlativas de Práctica Profesional, Taller de Tesina y Tesina salen del SIU Guaraní, no de los programas oficiales (que no las tienen).
