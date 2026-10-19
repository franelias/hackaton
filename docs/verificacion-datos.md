# Verificación de dudas de datos

Issue #6. Cada respuesta tiene su evidencia; los números salen de la API real (octubre 2026).

## 1. ¿Los horarios distinguen comisiones alternativas?

**En LCC no; en otras carreras sí.** Ninguna de las 110 clases de LCC tiene etiqueta de comisión: cada materia tiene un único horario semanal. En el resto de la API, 49 de las 276 materias con horario `2026-2S` tienen comisiones etiquetadas y 42 tienen dos o más (15 %), casi todas del ciclo básico. Vienen en el texto libre de `notes` (`Com.: 630 ciclo básico`, a veces `Com: 630 y Com: 660`).

Resuelto en `build_schedule` (#18): parsea `notes`, y si una materia tiene comisiones etiquetadas ignora las clases sin etiqueta (son duplicados parciales sin hora de fin).

## 2. ¿Incluyen la sede?

**Casi siempre en lo vigente.** La trae el 83 % de las 1053 clases. En LCC el 61 % (67 de 110), pero el 100 % de las de `2026-2S` (31 de 31): las 43 que no la tienen son todas de la "última publicación". Hay dos sedes, Pellegrini y el CUR; en LCC una sola clase está en el CUR (laboratorio de SO I, en la "última publicación"). El aviso de traslados de `build_schedule` casi no se dispara en LCC.

## 3. ¿Qué cubren las 7 entradas de calendario y las 12 mesas?

- **Las 7 entradas de `/calendar`**: 2 son de 2026 y no tienen fechas (la resolución del Calendario Académico, "detalle dentro del PDF", y "Mesas flotantes 2do cuatrimestre 2026"). Las otras 5 son de 2027 y son la **inscripción al ingreso**, no a mesas. No hay fechas de inscripción a mesas en ningún lado de la API, así que esa alerta no puede salir de ahí.
- **Las 12 mesas**: una por carrera (las 12 de la API, LCC es la `1`), todas "Mesas flotantes 2do cuatrimestre 2026" y solo con el PDF; sin fechas en la API.
- **El PDF de LCC** es de texto y trae fecha y hora por materia (29 filas) del 2.º llamado flotante: del 31/08 al 04/09/2026, que **ya pasó**. La API no lo expone. No se transcribe porque nada lo consume (la alerta de mesas está fuera del MVP).
- **El Calendario Académico 2026-27** (Res. DEC 1723/2025, Escuela de Ciencias Exactas y Naturales) es un gráfico escaneado, sin texto. Dice por escrito: inicio de actividades lunes 2/2/2026 y lunes 1/2/2027, Carnaval 16 y 17/2/2026 y 8 y 9/2/2027, Jueves y Viernes Santo 2 y 3/4/2026, inicio del cuatrimestre miércoles 4/3/2026 y lunes 1/3/2027. Los recesos y las semanas de mesas están en el gráfico: ya los transcribió Eugenio en `backend/data/periods_fceia_2026.json` (#10), que es la fuente para receso y época de parciales.
- **Códigos**: este PDF usa los códigos de la API (R-313 = Análisis de Lenguaje, R-322 = SO I), no los del plan ni los programas. La inconsistencia es de la facultad.

## 4. ¿Cómo tratar los exámenes sin fecha (52 %) en `frequent_topics`?

El 52 % es global: 494 de 944. Para LCC es el 23 % (100 de 437), y 77 de esos son **todos** los de Suficiencia de Inglés; sin ellos queda el 6 % (23 de 360). Otros 142 exámenes solo tienen año (fecha `AAAA-01-01`), que alcanza para `last_year`. De los 494 sin fecha solo 85 tienen un año reconocible en la descripción, el título o el nombre del archivo, así que inferirlo suma poco y arriesga errores.

**Tratamiento (ya implementado)**: los exámenes sin fecha cuentan en las frecuencias pero no aportan `last_year`, y `since` no los descarta. Se reportan en `undated`.

## 5. ¿Alcanzan los 10 exámenes de Lógica para la demo del Alumno B?

**Sí para práctica y simulacro, con un cambio en `frequent_topics`.**

- Son 10: 9 parciales (2015, 2016, 2017 y 2022) y 1 final (2021). Los 10 tienen texto (de 1,2 a 3,3 mil caracteres), 1 es escaneo (se muestra el PDF original) y no hay resoluciones: el tutor resuelve solo.
- **Problema**: `frequent_topics` devolvía 40 temas distintos y 36 aparecían una sola vez, porque los temas son texto libre. Con materias grandes el ranking funciona (Análisis I: "continuidad" en 34 de 56), con Lógica no.
- **Cambio**: `frequent_topics` ahora devuelve además `keywords`: palabras y pares de palabras con la cantidad de exámenes que los mencionan. Para Lógica: "deducción natural" 7 de 10, "consecuencia semántica" 6, "secuentes" 4, "consistencia" 4.
- **Otras materias de LCC** con buen volumen (exámenes con texto): Análisis I 56, EDA II 46, AGA I 41, Arquitectura 28, Álgebra Lineal 24. Sin ninguno: EDA I, AGA II, Modelos Físicos, Compiladores y Seguridad Informática.
- **Para el guion**: Lógica destraba 10 materias pero postergarla no atrasa la carrera (ver `camino-critico.md`); Programación II tiene 15 exámenes, destraba 17 y atrasa 2 cuatrimestres.
