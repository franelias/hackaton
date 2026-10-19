# Revisión del plan de LCC contra las fuentes oficiales

Issue #5. Las correcciones viven en `corrections/data/career_1.json` (módulo `corrections/`), cada una con una nota que cita su fuente. Las aplican el backend (`plan_career_1.json`) y el MCP (`prerequisites`, `build_schedule`), así los dos coinciden. La API no se toca.

## Fuentes

| Qué | Fuente |
|---|---|
| Estructura por año y cuatrimestre, horas, "28 obligatorias + 225 h electivas + Suficiencia de Inglés + Práctica Profesional + Tesina" | Plan de Estudios LCC, Res. CD 850/2023, sección 6 (`curriculum_pdf_url` de la API; es un escaneo) |
| Correlativas | **Programa 2024 de cada materia**, bloque "Espacios Curriculares Relacionados" (`syllabus_pdf_url` de la API): Previos Aprobados, Simultáneos Recomendados, Posteriores |
| Tesina, Práctica Profesional | Reglamentos del plan (Anexos II y III) y programa de Tesina |

**El plan oficial no trae correlativas**: dice "los requisitos de correlatividades serán aprobados oportunamente por el Consejo Directivo". La API atribuye sus correlativas a ese PDF, pero no están ahí; por eso se verificaron contra los programas. Los programas 2024 solo tienen "Previos Aprobados", así que `requirement: null` = `approved` queda **confirmado para LCC**.

## Años y cuatrimestres corregidos (10)

| Materia | API | Oficial |
|---|---|---|
| Programación I | 1.º año, 2.º cuat. | 1.º, 1.º |
| Estructuras de Datos y Algoritmos I | 1.º, 2.º | 2.º, 1.º |
| Complementos de Matemática I | 1.º, 2.º | 2.º, 2.º |
| Probabilidad y Estadística | 2.º, 2.º | 3.º, 1.º |
| Estructuras de Datos y Algoritmos II | 2.º, 2.º | 3.º, 1.º |
| Examen de Suficiencia de Inglés | 2.º, 2.º | 3.º, 1.º |
| Sistemas Operativos I | 3.º, 2.º | 3.º, 1.º |
| Análisis de Lenguajes de Programación | 1.º, 2.º | 3.º, 2.º |
| Ingeniería de Software I | 1.º, 2.º | 4.º, 1.º |
| Práctica Profesional | 1.º, 2.º | 5.º, 1.º |

## Correlativas corregidas (3 de 30)

| Materia | API | Oficial (Previos Aprobados) |
|---|---|---|
| Sistemas Operativos I | Lógica, EDA II, Análisis de Lenguajes | Lógica |
| Análisis de Lenguajes de Programación | Lógica | Lógica, EDA II |
| Ingeniería de Software I | Lógica, EDA II, Inglés, Sistemas Operativos II | Lógica, EDA II, Inglés |

Sistemas Operativos II y Análisis de Lenguajes figuran en los programas solo como "simultáneos recomendados", no como correlativas.

## Otras decisiones

- **Optativa I, II y III** no son materias: el plan solo prevé 225 h electivas (75 h en 5.º año 1.er cuat. y 150 h en el 2.º). Pasan a electivas (`optional`).
- **Práctica Profesional** es una actividad de 200 h más un seminario de 50 h, sin orden fijo ni correlativas: queda en 5.º año 1.er cuatrimestre.
- **Tesina** es el objetivo final: para presentarla hay que tener aprobadas todas las otras asignaturas. Queda **fuera del grafo** (`final_goal` en el plan, con `requires_all: true`): si dependiera de las 29 materias, todas sumarían +1 en `unlocks_total`. No cuenta en `min_terms`.
- **Códigos**: la API tiene intercambiados Sistemas Operativos I (API `r322`, oficial R-313) y Análisis de Lenguajes (API `r313`, oficial R-322). No se tocan: el código es la identidad de la materia en la API. Los programas y el plan usan los códigos oficiales.
- **Electivas**: de las 7, cinco tienen programa. Construcción Formal de Programas en Teoría de Tipos pide Lógica y Análisis de Lenguajes (la API no tiene esa correlativa); las otras no tienen previos, y Bases de Datos Avanzadas y Simulación de Sistemas Continuos no tienen programa. No se corrigen: son opcionales y quedan fuera del grafo base.

## Las 30 materias

Correlativas oficiales (programas 2024) contra las de la API. Las columnas de correlativas usan los códigos oficiales.

| Código | Materia | Código API | Oficial | API | |
|---|---|---|---|---|---|
| R-111 | Álgebra y Geometría Analítica I | r111 | — | — | ✓ |
| R-112 | Análisis Matemático I | r112 | — | — | ✓ |
| R-113 | Programación I | r113 | — | — | ✓ |
| R-121 | Álgebra y Geometría Analítica II | r121 | R-111 | R-111 | ✓ |
| R-122 | Análisis Matemático II | r122 | R-112 | R-112 | ✓ |
| R-123 | Programación II | r123 | R-113 | R-113 | ✓ |
| R-211 | Álgebra Lineal | r211 | R-121 | R-121 | ✓ |
| R-212 | Estructuras de Datos y Algoritmos I | r212 | R-123 | R-123 | ✓ |
| R-213 | Lenguajes Formales y Computabilidad | r213 | R-123 | R-123 | ✓ |
| R-221 | Complementos de Matemática I | r221 | R-211, R-212 | R-211, R-212 | ✓ |
| R-222 | Arquitectura del Computador | r222 | R-212 | R-212 | ✓ |
| R-223 | Lógica | r223 | R-123 | R-123 | ✓ |
| R-224 | Métodos Numéricos | r224 | R-122, R-211 | R-122, R-211 | ✓ |
| R-311 | Probabilidad y Estadística | r311 | R-122 | R-122 | ✓ |
| R-312 | Estructuras de Datos y Algoritmos II | r312 | R-212, R-221 | R-212, R-221 | ✓ |
| R-313 | Sistemas Operativos I | r322 | R-223 | R-223, R-312, R-322 | **✗** |
| R-314 | Examen de Suficiencia de Inglés | r314 | — | — | ✓ |
| R-321 | Modelos Físicos | r321 | R-311 | R-311 | ✓ |
| R-322 | Análisis de Lenguajes de Programación | r313 | R-223, R-312 | R-223 | **✗** |
| R-323 | Comunicaciones | r323 | R-222 | R-222 | ✓ |
| R-324 | Teoría de Base de Datos | r324 | R-223, R-312 | R-223, R-312 | ✓ |
| R-411 | Ingeniería de Software I | r411 | R-223, R-312, R-314 | R-223, R-312, R-314, R-412 | **✗** |
| R-412 | Sistemas Operativos II | r412 | R-222, R-313, R-314 | R-222, R-313, R-314 | ✓ |
| R-413 | Introducción a la Inteligencia Artificial | r413 | R-223, R-312, R-314, R-324 | R-223, R-312, R-314, R-324 | ✓ |
| R-421 | Ingeniería de Software II | r421 | R-411 | R-411 | ✓ |
| R-422 | Compiladores | r422 | R-213, R-312, R-314, R-322 | R-213, R-312, R-314, R-322 | ✓ |
| R-423 | Complementos de Matemática II | r423 | R-122, R-211, R-223, R-314 | R-122, R-211, R-223, R-314 | ✓ |
| R-511 | Seguridad Informática | r511 | R-411 | R-411 | ✓ |
| R-512 | Práctica Profesional | r513 | — | — | ✓ |
| R-513 | Taller de Tesina | r514 | — | — | ✓ |

## Cómo repetir la revisión

1. Bajar el `syllabus_pdf_url` de cada materia (`/careers/{id}/curriculum`) y leer "Previos Aprobados".
2. Compararlo con `/subjects/{id}/relations`.
3. Agregar la diferencia a `corrections/data/career_<id>.json` con su `note`; el módulo rechaza campos desconocidos y correcciones sobre materias o correlativas que no existen.
4. `cd backend && go run ./cmd/plan -career <id>` regenera el plan.
