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

## Correlativas del SIU Guaraní (issue #33)

Los programas 2024 no tienen correlativas para Práctica Profesional, Taller de Tesina ni Tesina. Se cargaron las del SIU Guaraní:

| Materia | Correlativas cargadas | Directas, después de reducir |
|---|---|---|
| Práctica Profesional (R-513) | 23: Álgebra I y II, Álgebra Lineal, Análisis I y II, Análisis de Lenguajes, Complementos I, Comunicaciones, EDA I y II, Inglés, Ingeniería de Software I y II, Inteligencia Artificial, Lenguajes Formales, Lógica, Métodos Numéricos, Modelos Físicos, Programación I y II, Sistemas Operativos I y II, Teoría de Base de Datos | Lenguajes Formales, Métodos Numéricos, Análisis de Lenguajes, Modelos Físicos, Comunicaciones, Sistemas Operativos II, Inteligencia Artificial, Ingeniería de Software II |
| Taller de Tesina (R-514) | Las mismas 23 | Las mismas 8 |
| Tesina (R-523) | Las 30 obligatorias restantes y Optativa I, II y III | Compiladores, Complementos II, Práctica Profesional, Taller de Tesina, Seguridad Informática, Optativa I, II y III |

## Solo correlativas directas

Si C depende de A y de B, y B depende de A, no se guarda que C depende de A: es implícito, porque para aprobar B hay que tener A. La reducción la hace `corrections.Graph` después de aplicar las correcciones, y la usan el plan y las tools del MCP (`prerequisites`, `build_schedule`), así los dos muestran las mismas correlativas. Una correlativa se considera implícita solo si otra materia que se pide **aprobada** la garantiza; una que se pide regular no garantiza las de más atrás.

En los datos de la API sobraban 4: EDA II ← EDA I (implícita por Complementos I), Inteligencia Artificial ← Lógica y ← EDA II (implícitas por Teoría de Base de Datos) y Compiladores ← EDA II (implícita por Análisis de Lenguajes). Con las del SIU Guaraní, se reducen también las de Práctica Profesional, Taller de Tesina y Tesina.

## Otras decisiones

- **Optativa I, II y III** son los tres espacios de horas electivas del plan (225 h: 75 h en 5.º año 1.er cuat. y 150 h en el 2.º). Son **obligatorias, sin correlativas**: la Tesina depende de ellas (issue #33). Antes se marcaban como electivas.
- **Práctica Profesional** es una actividad de 200 h más un seminario de 50 h: queda en 5.º año 1.er cuatrimestre. Sus correlativas salen del SIU Guaraní (abajo).
- **Tesina** es la última materia: depende de todas las obligatorias y de las tres optativas (SIU Guaraní). Está **dentro del grafo** como una materia más, así que suma en `unlocks_total` y cierra el camino crítico. Antes quedaba aparte, en `final_goal`.
- **Códigos**: la API tiene Sistemas Operativos I como `r322` y Análisis de Lenguajes como `r313`; el plan y los programas 2024 dicen lo contrario (R-313 SO I, R-322 Análisis de Lenguajes). El PDF de mesas de la facultad usa los de la API, así que la inconsistencia es de la facultad y no de la API. No se tocan: el código es la identidad de la materia en la API.
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
4. `cd backend && go run ./cmd/arbol plan --career <id>` regenera el plan.
