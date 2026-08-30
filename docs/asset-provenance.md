# Asset and IP provenance

Floortris ships only project-authored source, dependency assets delivered by the
declared npm packages, and the six local concept textures below. There are no
third-party stock photos, product photographs, logos, fonts, analytics pixels,
or remote font requests in the application.

| Asset group | Location | Provenance and permitted use |
| --- | --- | --- |
| Application UI, diagrams and furniture shapes | `app/`, `components/` | Original TypeScript, CSS and HTML authored for this project. CSS shapes are not copied product designs. |
| Concept texture pack | `public/textures/*.webp` | Original images generated with OpenAI's built-in image-generation tool for this project. The complete generation briefs and IDs are retained in `docs/texture-prompts.json`. They are illustrative concept finishes, not real brands, product scans, or seamless-material claims. |
| Social preview | `public/og.png` | Project-specific Floortris preview artwork. It is stored and served locally. |
| Runtime/library code | `package.json`, lockfile | Installed under each dependency's own licence; this project does not redistribute dependency source as an authored asset. |

Before a public release, the owner should review this register alongside the
licences for every dependency, retain the generation records, and replace any
asset if a rights concern is raised. No claim is made that the concept textures
represent a specific manufacturer, interior product, or professionally surveyed
material.
