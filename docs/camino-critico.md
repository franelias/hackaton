# Cuellos de botella y camino crítico

Issue #3. Código en `backend/internal/plan`; resultado en `backend/data/plan_career_1.json` (Licenciatura en Ciencias de la Computación), con la forma de `contratos.md` §2.1. Se calcula sobre las correlativas **ya revisadas** contra las fuentes oficiales (`revision-plan-lcc.md`).

## Modelo

- Cada materia ocupa **un cuatrimestre**, sin límite de materias por cuatrimestre, y arranca el cuatrimestre siguiente a que se aprueban todas sus correlativas. Es un **piso optimista**: nadie se recibe en menos.
- El grafo base son las **obligatorias** (30) con las correlativas de la API más las correcciones de `corrections/`. Las **electivas** son nodos opcionales: no cuentan en el plan base y se suman al camino crítico solo cuando el alumno las elige (`Result.Analyze`).
- La **Tesina** es el objetivo final y queda fuera del grafo: `final_goal` en el plan, con `requires_all: true`. No cuenta en `min_terms` ni en `unlocks_total`.
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

La carrera lleva **7 cuatrimestres como mínimo** (el plan oficial pone 10). Camino crítico: Álgebra I → Álgebra II → Álgebra Lineal → Complementos de Matemática I → EDA II → Teoría de Base de Datos → Introducción a la Inteligencia Artificial. Con las correlativas sin corregir daba 9: las tres correlativas erróneas de la API alargaban la cadena por Sistemas Operativos.

| Materia | Destraba (directo) | Destraba (total) | Holgura | Atraso si se pospone un año |
|---|---|---|---|---|
| Programación I | 1 | 18 | 0 | 2 |
| Programación II | 3 | 17 | 0 | 2 |
| Álgebra y Geometría Analítica I | 1 | 13 | 0 | 2 |
| Álgebra y Geometría Analítica II | 1 | 12 | 0 | 2 |
| Estructuras de Datos y Algoritmos I | 3 | 12 | 0 | 2 |
| Álgebra Lineal | 3 | 11 | 0 | 2 |
| **Lógica** | 6 | **10** | 2 | **0** |
| Complementos de Matemática I | 1 | 8 | 0 | 2 |
| Estructuras de Datos y Algoritmos II | 5 | 7 | 0 | 2 |
| Examen de Suficiencia de Inglés | 5 | 7 | 4 | 0 |

Cuellos de botella (`unlocks_total >= 8`): Programación I y II, Álgebra I y II, Álgebra Lineal, EDA I, Complementos I y Lógica.

**Para el pitch**
- "De las 30 obligatorias, **10 dependen de Lógica**, y 6 la piden directamente." Es el número fuerte para Lógica.
- Postergar Lógica **no atrasa** la carrera (holgura 2): lo que pierde el alumno es que quedan trabadas 10 materias, no cuatrimestres. No conviene decir "dejar Lógica te atrasa N cuatrimestres".
- Las que sí atrasan **2 cuatrimestres** si se posponen un año son 15, entre ellas Programación I y II, Álgebra I y II, Álgebra Lineal, EDA I y II y Complementos I. Programación I y II son las que más destraban (18 y 17).
- Suficiencia de Inglés destraba 5 directas, pero tiene holgura 4: no atrasa nada, así que no es cuello de botella.

## Límites
- Piso optimista: no modela cuántas materias entran en un cuatrimestre, ni que se dicten solo en su cuatrimestre.
- Tesina, Taller de Tesina y Práctica Profesional no tienen correlativas en los programas oficiales. La Tesina se reporta aparte; las otras dos no extienden el camino crítico.
