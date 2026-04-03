# SPEC WORKFLOW GUIDE

## OVERVIEW
`.spec-workflow/` is scaffolding for spec/steering documents, not the live application. Today the useful content is in templates; `specs/`, `steering/`, and `archive/` are empty.

## STRUCTURE
```text
.spec-workflow/
├── templates/        # Generic requirements/design/tasks/steering templates
├── user-templates/   # Local template overrides/extensions
├── approvals/        # Approval metadata/state
├── specs/            # Currently empty
├── steering/         # Currently empty
└── archive/          # Currently empty
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Template wording / skeleton docs | `templates/*.md` | Generic starting points only |
| Local customization of templates | `user-templates/` | Small overlay area |
| Approval state | `approvals/` | Workflow metadata, not product logic |
| Actual app intent | `../task.md`, `../src/**` | Do not infer runtime behavior from templates |

## CONVENTIONS
- Treat template files as placeholders to fill, not as source-of-truth architecture.
- Keep future generated specs under `specs/`; keep steering docs under `steering/`.
- When reconciling template guidance with repo code, the implemented app wins.

## ANTI-PATTERNS
- Do not copy placeholder template text into repo knowledge docs as if it described this project.
- Do not assume empty `specs/` or `steering/` directories imply missing runtime modules.
- Do not document template examples as existing source files; many paths in templates are illustrative only.

## NOTES
- The task templates are intentionally verbose and role-oriented; they describe workflow output, not current repo conventions.
