# Cuellos de botella y camino crítico

Issue #3. Código en `backend/internal/plan`; resultado en `backend/data/plan_career_1.json` (Licenciatura en Ciencias de la Computación), con la forma de `contratos.md` §2.1.

## Modelo

- Cada materia ocupa **un cuatrimestre**, sin límite de materias por cuatrimestre, y arranca el cuatrimestre siguiente a que se aprueban todas sus correlativas. Es un **piso optimista**: nadie se recibe en menos.
- El grafo base son las **obligatorias** (30) con las correlativas de la API. Las **electivas** son nodos opcionales: no cuentan en el plan base y se suman al camino crítico solo cuando el alumno las elige (`Result.Analyze`).
- Las materias se dictan una vez al año, así que **"dejar" una materia es posponerla un año (2 cuatrimestres)**.
- No se usa el campo `year` de la API para calcular nada: tiene errores. Todo sale de las correlativas.

| Métrica | Definición |
|---|---|
| `unlocks` | Materias que la requieren directamente |
| `unlocks_total` | Directas + indirectas |
| `bottleneck` | `unlocks_total >= 8` |
| `slack` | Cuatrimestres que se puede demorar sin atrasar la carrera; 0 = camino crítico |
| `postpone_year_delay` | Cuatrimestres que se atrasa la carrera si la materia se pospone un año |
| `min_terms` / `critical_path` | Largo y cadena de la ruta más larga (desempate por menor `subject_id`) |

## Resultado para LCC

La carrera lleva **9 cuatrimestres como mínimo** (el plan oficial pone 10). Camino crítico: Álgebra I → Álgebra II → Álgebra Lineal → Complementos de Matemática I → EDA II → Sistemas Operativos I → Sistemas Operativos II → Ingeniería de Software I → II.

| Materia | Destraba (directo) | Destraba (total) | Holgura | Atraso si se pospone un año |
|---|---|---|---|---|
| Programación I | 1 | 18 | 0 | 2 |
| Programación II | 3 | 17 | 0 | 2 |
| Álgebra y Geometría Analítica I | 1 | 14 | 0 | 2 |
| Álgebra y Geometría Analítica II | 1 | 13 | 0 | 2 |
| Estructuras de Datos y Algoritmos I | 3 | 12 | 0 | 2 |
| Álgebra Lineal | 3 | 12 | 0 | 2 |
| **Lógica** | 6 | **10** | 1 | **1** |
| Complementos de Matemática I | 1 | 9 | 0 | 2 |
| Estructuras de Datos y Algoritmos II | 5 | 8 | 0 | 2 |
| Examen de Suficiencia de Inglés | 5 | 7 | 5 | 0 |

**Para el pitch**
- "De las 30 obligatorias, **10 dependen de Lógica**, y 6 la piden directamente." Es el número fuerte para Lógica.
- "Dejar Lógica un año atrasa la carrera **1 cuatrimestre**" (y 0 si se pospone un solo cuatrimestre). Es verdad pero chico: Lógica tiene holgura 1.
- Las que atrasan **2 cuatrimestres** son Programación I y II, Álgebra I y II, EDA I y II, Álgebra Lineal y Complementos I.
- Suficiencia de Inglés destraba 5 directas, pero tiene holgura 5: no atrasa nada, así que no es cuello de botella.

## Límites
- Piso optimista: no modela cuántas materias entran en un cuatrimestre, ni que se dicten solo en su cuatrimestre.
- `requirement: null` en la API se trata como `approved` (a confirmar en #6).
- Tesina, Taller de Tesina, Práctica Profesional y las 3 optativas obligatorias no tienen correlativas en la API, así que no extienden el camino crítico. Si Tesina debe venir después de todo, se agrega con `add_prerequisites` en `backend/data/overrides/career_1.json` (#5).
- Año y cuatrimestre de la API tienen errores (p. ej. Ingeniería de Software I figura en 1.er año): se corrigen en esa misma capa (#5).
