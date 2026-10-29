# SEO Implementation Documentation

> **Site:** https://3dmodelfileconverter.com  
> **Primary Keyword:** `3d model file converter`  
> **Stack:** Astro 7.4.1 (static output) + React + Three.js + OpenCASCADE WebAssembly  
> **Date:** October 2026  

---

## Table of Contents

1. [Scope & Constraints](#1-scope--constraints)
2. [Site Architecture & URL Structure](#2-site-architecture--url-structure)
3. [Layout.astro — Global SEO Infrastructure](#3-layoutastro--global-seo-infrastructure)
4. [Homepage SEO](#4-homepage-seo)
5. [Converter Pages SEO (25 Pages)](#5-converter-pages-seo-25-pages)
6. [SEO Content Data — seo-content.ts](#6-seo-content-data--seo-contentts)
7. [Meta Descriptions — Full List](#7-meta-descriptions--full-list)
8. [Page Titles — Full List](#8-page-titles--full-list)
9. [H1 Tags & Subtitles](#9-h1-tags--subtitles)
10. [Content Section Headings (H2s)](#10-content-section-headings-h2s)
11. [Supporting Keywords — Full Map](#11-supporting-keywords--full-map)
12. [Word Count Report](#12-word-count-report)
13. [Internal Linking Strategy](#13-internal-linking-strategy)
14. [Structured Data (JSON-LD)](#14-structured-data-json-ld)
15. [Open Graph & Twitter Cards](#15-open-graph--twitter-cards)
16. [Canonical URLs & Duplicate Handling](#16-canonical-urls--duplicate-handling)
17. [Sitemap & Robots.txt](#17-sitemap--robotstxt)
18. [OG Image](#18-og-image)
19. [Anti-Duplicate Content Strategy](#19-anti-duplicate-content-strategy)
20. [What Was NOT Done (Out of Scope)](#20-what-was-not-done-out-of-scope)
21. [Files Modified — Complete List](#21-files-modified--complete-list)
22. [Audit Results — Final State](#22-audit-results--final-state)

---

## 1. Scope & Constraints

### What was in scope
- **On-page SEO only** — title tags, meta descriptions, H1s, H2s, body content, structured data, OG tags, canonical URLs, sitemap, robots.txt, internal linking
- 25 converter pages + 1 homepage
- Main keyword: `3d model file converter`
- Supporting keywords: from Ahrefs manual research (user-provided list)

### Constraints enforced
| Rule | Rationale |
|------|-----------|
| **No FAQ sections** | User will provide a separate FAQ prompt later |
| **No copy-paste templates with swapped names** | Google treats as duplicate content |
| **Format notes MUST differ on every page** | Prevents duplicate classification across 25 similar pages |
| **Top 15 pairs: 350–400+ words; others: ≥300 words; never under 200** | AdSense content threshold |
| **Use exact supporting keywords from Ahrefs** | Don't invent new keywords |
| **Meta descriptions: ≤160 characters** | SERP truncation threshold |
| **Every meta description has a unique opening** | Avoid templated patterns Google may penalize |
| **All content is high-quality, unique per page** | Not boilerplate with format names swapped |

---

## 2. Site Architecture & URL Structure

```
https://3dmodelfileconverter.com/
├── /                           ← Homepage (converter + SEO content)
├── /stl-to-obj                 ← 25 converter pages
├── /stl-to-step
├── /stl-to-3mf
├── /stl-to-glb
├── /obj-to-stl
├── /obj-to-step
├── /obj-to-3mf
├── /obj-to-glb
├── /step-to-stl
├── /step-to-obj
├── /step-to-3mf
├── /step-to-glb
├── /3mf-to-stl
├── /3mf-to-obj
├── /3mf-to-step
├── /3mf-to-glb
├── /glb-to-stl
├── /glb-to-obj
├── /glb-to-step
├── /glb-to-3mf
├── /iges-to-stl
├── /iges-to-obj
├── /iges-to-step
├── /iges-to-3mf
├── /iges-to-glb
├── /about                      ← Primary URL
├── /about-us                   ← Alias → canonical: /about
├── /contact                    ← Primary URL
├── /contact-us                 ← Alias → canonical: /contact
├── /privacy                    ← Primary URL
├── /privacy-policy             ← Alias → canonical: /privacy
├── /terms                      ← Primary URL
├── /terms-and-conditions       ← Alias → canonical: /terms
├── /sitemap-index.xml          ← Auto-generated sitemap
└── /robots.txt                 ← Crawl directives
```

**6 input formats:** STL, OBJ, STEP, 3MF, GLB, IGES  
**5 output formats:** STL, OBJ, STEP, 3MF, GLB (IGES is input-only)  
**25 unique conversion paths** total  
**34 total built pages** (25 converters + homepage + 4 info pages + 4 alias pages)

---

## 3. Layout.astro — Global SEO Infrastructure

**File:** `src/layouts/Layout.astro`

Every page inherits SEO infrastructure from the shared layout. The following props are available:

```typescript
interface Props {
  title?: string;
  description?: string;
  canonicalPath?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  structuredData?: object;  // Single object or array of objects
}
```

### What the layout renders in `<head>`:

| Tag | Implementation |
|-----|---------------|
| `<title>` | Dynamic per page |
| `<meta name="description">` | Dynamic per page |
| `<link rel="canonical">` | Computed from `siteUrl + canonicalPath` |
| `<meta name="robots">` | `index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1` |
| `<meta property="og:type">` | Default `website`, overridable |
| `<meta property="og:url">` | Same as canonical URL |
| `<meta property="og:title">` | Falls back to `<title>` if not specified |
| `<meta property="og:description">` | Falls back to meta description |
| `<meta property="og:image">` | `https://3dmodelfileconverter.com/og-image.png` |
| `<meta property="og:image:width">` | `1200` |
| `<meta property="og:image:height">` | `630` |
| `<meta property="og:image:alt">` | Descriptive alt text |
| `<meta property="og:site_name">` | `3D Model File Converter` |
| `<meta property="og:locale">` | `en_US` |
| `<meta name="twitter:card">` | `summary_large_image` |
| `<meta name="twitter:title">` | Same as OG title |
| `<meta name="twitter:description">` | Same as OG description |
| `<meta name="twitter:image">` | Same as OG image |
| `<script type="application/ld+json">` | Supports both single object and array (multiple JSON-LD blocks) |

### Structured data handling

The layout intelligently handles structured data:
- If `structuredData` is an **array**, each item gets its own `<script type="application/ld+json">` block
- If it's a **single object**, one block is rendered
- If `null/undefined`, nothing is rendered

This allows the homepage to emit 3 JSON-LD blocks and converter pages to emit 2 JSON-LD blocks.

---

## 4. Homepage SEO

**File:** `src/pages/index.astro`

### Meta tags

| Field | Value |
|-------|-------|
| Title | `3D Model File Converter — Free Online STL, OBJ, STEP, 3MF, GLB & IGES Converter` |
| Meta Description | `Convert 3D model files between STL, OBJ, STEP, 3MF, GLB, and IGES instantly — free, private, and 100% in-browser. No uploads, no signup, no file-size limits.` |
| Canonical | `https://3dmodelfileconverter.com` |
| OG Title | `3D Model File Converter — Free, Private, In-Browser` |

### Content sections (~1,286 words total)

The homepage has 5 long-form SEO content sections rendered below the converter tool:

1. **"What Is a 3D Model File Converter?"** — Defines the tool, lists all 6 formats, explains 25 conversion paths
2. **"Why a Browser-Based Converter Changes Everything"** — Privacy, no file-size limits, speed; links to OpenCASCADE
3. **"Supported 3D File Formats"** — 6 format cards (STL, OBJ, STEP, 3MF, GLB, IGES) with descriptions
4. **"Who Uses This 3D Model File Converter?"** — Use cases: 3D printing enthusiasts, product designers, game developers, mechanical engineers, architects
5. **"Under the Hood: WebAssembly-Powered Conversion"** — Technical architecture: OpenCASCADE WASM, Three.js, Web Workers

### Internal linking grid

Below the content, a **"All Supported Conversions"** grid links to all 25 converter pages, organized by source format (6 columns). Each link uses the format `/{slug}` and displays as `{FromLabel} to {ToLabel}`.

### Structured Data (3 JSON-LD blocks)

1. **WebApplication** — name, url, description, applicationCategory: "DesignApplication", offers (free), featureList (all 25 conversions + features)
2. **WebSite** — with SearchAction (`?q={search_term_string}`)
3. **Organization** — name, url, logo, contactPoint (email: hello@3dmodelfileconverter.com)

---

## 5. Converter Pages SEO (25 Pages)

**File:** `src/pages/[slug].astro`

Each converter page is dynamically generated from `CONVERSIONS` data and enriched with unique SEO content from `seo-content.ts`.

### Page structure (top to bottom)

1. **Visible breadcrumb** — `3D Converter / STL to OBJ` — with schema.org microdata (`BreadcrumbList` via `itemscope`)
2. **Hero section** — `Free · Private · In-Browser` badge → H1 → H1 subtitle
3. **Converter tool** — React component with `defaultFrom` and `defaultTo` pre-set
4. **How-it-works cards** — 4 contextual cards (format-aware, not generic). Cards mention the specific source/target format names
5. **Unique SEO content article** — 4 sections with unique H2 headings and body text:
   - Intro (why this conversion matters)
   - How it works (technical explanation, inside a styled card)
   - Format notes (unique per page — the anti-duplicate differentiator)
   - Use cases (industry scenarios, inside a styled card)
6. **Related conversions** — Internal linking section:
   - Reverse conversion link (if exists)
   - Other conversions from the same source format
   - "All Conversions" CTA button linking back to homepage

### Per-page meta tags

| Field | Source |
|-------|--------|
| Title | `seo.title` from `seo-content.ts` |
| Meta Description | `seo.metaDescription` from `seo-content.ts` |
| Canonical | `https://3dmodelfileconverter.com/{slug}` |
| OG Title | `{FromLabel} to {ToLabel} Converter — Free Online Tool` |
| OG Description | Same as meta description |

### Per-page structured data (2 JSON-LD blocks)

1. **WebApplication** — specific to this conversion, with `isPartOf` referencing the parent WebSite
2. **BreadcrumbList** — 2-level breadcrumb (Home → This Converter)

---

## 6. SEO Content Data — seo-content.ts

**File:** `src/data/seo-content.ts` (679 lines)

### Data structure

```typescript
export interface ConversionSEO {
  slug: string;
  title: string;
  metaDescription: string;
  h1: string;
  h1Subtitle: string;
  introHeading: string;
  introText: string;           // Multi-paragraph (separated by \n\n)
  howItWorksHeading: string;
  howItWorksText: string;      // Multi-paragraph
  formatNotesHeading: string;
  formatNotesText: string;     // Multi-paragraph — UNIQUE per page
  useCasesHeading: string;
  useCasesText: string;
  primaryKeyword: string;
  supportingKeywords: string[];
}

export const SEO_CONTENT: Record<string, ConversionSEO> = { ... };
```

### Content uniqueness strategy

Every single field was written uniquely per page:

- **introHeading**: 25 unique headings, each approaching the topic from a different angle (e.g., "Bridging the Gap Between Mesh and CAD", "From 3D Printing to the Web: STL Meets GLB", "STL Is Showing Its Age — 3MF Is the Future")
- **introText**: Each tells a different story — problem statement, format comparison, industry context, workflow scenario
- **howItWorksHeading**: Varied patterns — "How X Works", "Under the Hood of X", "The X Pipeline", "How X Become Y"
- **formatNotesHeading**: 25 completely different headings (e.g., "Technical Notes: STL vs. OBJ Geometry", "Understanding the Faceted BREP Limitation", "Color Handling and Material Mapping")
- **formatNotesText**: The primary anti-duplicate differentiator. Each page discusses format-specific technical details that cannot be template-swapped
- **useCasesHeading**: Varied patterns — "Common Use Cases", "Who Converts X to Y?", "When to Use X to Y", "Popular X to Y Scenarios"

---

## 7. Meta Descriptions — Full List

All 25 meta descriptions are unique in both content and opening pattern. None share the same first 3 words. All are ≤160 characters.

| Slug | Length | Meta Description |
|------|--------|-----------------|
| stl-to-obj | 158 | Free STL to OBJ file converter that runs in your browser. Rebuilds vertex normals, merges shared vertices, and outputs clean Wavefront OBJ — no upload needed. |
| stl-to-step | 151 | Need to turn an STL mesh into a CAD-ready STEP file? Our browser-based converter wraps triangles into a faceted BREP solid — free, private, no install. |
| stl-to-3mf | 156 | Upgrade legacy STL files to the modern 3MF printing format — free and 100% browser-based. Embeds units, metadata, and ZIP packaging with no upload required. |
| stl-to-glb | 157 | Turn your .stl meshes into web-ready GLB (glTF Binary) files with PBR materials — free, private, and browser-based. Perfect for Three.js, AR, and 3D viewers. |
| obj-to-stl | 156 | Need a slicer-ready STL from a Wavefront OBJ mesh? Our free browser-based converter triangulates polygons and strips textures — no upload, no signup needed. |
| obj-to-step | 157 | Free OBJ to STEP converter online — wrap polygon meshes into CAD-compatible BREP solids for SolidWorks, Fusion 360, and CNC. Runs in your browser, no upload. |
| obj-to-3mf | 149 | Package your OBJ meshes into the modern 3MF printing format with proper units and XML structure — free online OBJ to 3MF converter, no upload needed. |
| obj-to-glb | 154 | Looking for an online OBJ to GLB converter? Embed textures, preserve UVs, and export glTF binary for web, AR, and game engines — free, no upload required. |
| step-to-stl | 159 | Tessellate precise STEP CAD geometry into 3D-printable STL triangle meshes — free online converter, fully browser-based, private, no software install required. |
| step-to-obj | 150 | Free .STEP to OBJ converter — tessellate CAD solids into Wavefront OBJ meshes with smooth normals for Blender and rendering. No upload, fully private. |
| step-to-3mf | 154 | Skip the STL middleman — tessellate STEP CAD solids directly into print-ready 3MF packages with units and metadata. Free, browser-based, no upload needed. |
| step-to-glb | 152 | Instantly transform STEP CAD models into web-ready GLB (glTF Binary) with PBR materials — free online converter, fully browser-based, no install needed. |
| 3mf-to-stl | 157 | Extract triangle geometry from 3MF packages and export universal STL files for any slicer — free browser-based 3MF to STL converter, no upload, 100% private. |
| 3mf-to-obj | 156 | Need to open a 3MF file in Blender or Maya? Our free 3MF to OBJ converter online extracts meshes with preserved vertex structure — no upload, browser-based. |
| 3mf-to-step | 152 | Wrap 3MF printing meshes into CAD-compatible STEP BREP solids for SolidWorks and Fusion 360 — free 3MF to STEP file converter, browser-based, no upload. |
| 3mf-to-glb | 151 | Transform 3D printing 3MF files into web-ready GLB with PBR materials and optional color mapping — free browser-based converter, no upload, no install. |
| glb-to-stl | 160 | Strip PBR materials and animations from GLB files and export clean, slicer-ready STL triangle meshes — free GLB to STL file converter, no upload, fully private. |
| glb-to-obj | 152 | Extract meshes with UV coordinates and texture references from .glb files into Wavefront OBJ — free online converter, browser-based, no upload required. |
| glb-to-step | 148 | Wrap .glb polygon meshes into CAD-compatible STEP BREP solids for SolidWorks and Fusion 360 — free online GLB to STEP converter, no upload required. |
| glb-to-3mf | 140 | Map PBR materials and vertex colors from GLB to 3MF for full-color 3D printing — free browser-based converter, no upload, no install needed. |
| iges-to-stl | 149 | Tessellate legacy IGES CAD surfaces into 3D-printable STL meshes — free IGES to STL converter online, runs in your browser with no upload or install. |
| iges-to-obj | 156 | Bring legacy IGES CAD geometry into Blender and rendering pipelines — free online IGES to OBJ converter with smooth NURBS-derived normals. No upload needed. |
| iges-to-step | 154 | Upgrade legacy IGES CAD files to the modern ISO 10303 STEP standard — free IGES to STEP converter online, lossless BREP translation, no upload or install. |
| iges-to-3mf | 155 | Print parts from decades-old IGES CAD archives — our free converter tessellates NURBS surfaces into 3MF packages with units and metadata. No upload needed. |
| iges-to-glb | 158 | Make decades-old IGES CAD models viewable in any browser — free IGES to GLB converter tessellates NURBS into glTF binary with PBR materials. No upload needed. |

### Opening pattern diversity

No two meta descriptions share the same first 3 words. Patterns used:

- `Free STL to...` / `Free OBJ to...` / `Free .STEP to...`
- `Need to turn...` / `Need a slicer-ready...` / `Need to open...`
- `Upgrade legacy STL...` / `Upgrade legacy IGES...`
- `Turn your .stl...`
- `Looking for an...`
- `Package your OBJ...`
- `Tessellate precise STEP...` / `Tessellate legacy IGES...`
- `Skip the STL...`
- `Instantly transform STEP...`
- `Extract triangle geometry...` / `Extract meshes with...`
- `Wrap 3MF printing...` / `Wrap .glb polygon...`
- `Transform 3D printing...`
- `Strip PBR materials...`
- `Map PBR materials...`
- `Bring legacy IGES...`
- `Print parts from...`
- `Make decades-old IGES...`

---

## 8. Page Titles — Full List

| Slug | Title |
|------|-------|
| stl-to-obj | STL to OBJ Converter — Free Online STL to OBJ File Converter |
| stl-to-step | STL to STEP Converter — Convert STL Mesh to STEP CAD File Free |
| stl-to-3mf | STL to 3MF Converter Online — Convert STL to 3MF Free |
| stl-to-glb | STL to GLB Converter — Convert STL to GLB Online Free |
| obj-to-stl | OBJ to STL Converter — Convert OBJ to STL Online Free |
| obj-to-step | OBJ to STEP Converter — Convert OBJ Mesh to STEP CAD File Online |
| obj-to-3mf | OBJ to 3MF Converter — Convert OBJ to 3MF With Color Online |
| obj-to-glb | OBJ to GLB Converter — Convert OBJ to GLB With Texture Free |
| step-to-stl | STEP to STL Converter — Convert STEP to STL Free Online |
| step-to-obj | STEP to OBJ Converter — Convert .STEP to OBJ Online Free |
| step-to-3mf | STEP to 3MF Converter — Convert .STEP to 3MF Online |
| step-to-glb | STEP to GLB Converter — Convert STEP to GLB Online |
| 3mf-to-stl | 3MF to STL Converter — Convert 3MF to STL Online Free |
| 3mf-to-obj | 3MF to OBJ Converter — Convert 3MF to OBJ Online |
| 3mf-to-step | 3MF to STEP Converter — Convert 3MF to STEP File Online |
| 3mf-to-glb | 3MF to GLB Converter — Convert 3MF to GLB Online |
| glb-to-stl | GLB to STL Converter — Convert GLB to STL Online Free |
| glb-to-obj | GLB to OBJ Converter — Convert GLB to OBJ With Texture Free |
| glb-to-step | GLB to STEP Converter — Convert .GLB to STEP Online |
| glb-to-3mf | GLB to 3MF Converter — Convert GLB to 3MF With Color |
| iges-to-stl | IGES to STL Converter — Convert IGES to STL Online |
| iges-to-obj | IGES to OBJ Converter — Convert IGES to OBJ Online Free |
| iges-to-step | IGES to STEP Converter — Convert IGES to STEP File Online |
| iges-to-3mf | IGES to 3MF Converter — Convert IGES to 3MF Online |
| iges-to-glb | IGES to GLB Converter — Convert IGES to GLB Online |

### Title formula

`{From} to {To} Converter — {Unique Action Phrase}`

Each title includes:
- The primary keyword (`X to Y Converter`)
- A unique action phrase varying across: `Convert`, `Free Online`, `With Color`, `With Texture`, `File Online`, etc.

---

## 9. H1 Tags & Subtitles

### H1 tags
Every page has an H1 matching the format `{From} to {To} Converter` — clean, keyword-rich, and consistent.

### H1 subtitles
Each subtitle is unique — different verb phrases, different technical angles:

| Slug | H1 Subtitle |
|------|-------------|
| stl-to-obj | Transform stereolithography meshes into Wavefront OBJ files with reconstructed normals and shared vertices — instantly, privately, in your browser. |
| stl-to-step | Wrap your STL triangle mesh into a faceted BREP solid body that CAD software can import — all inside your browser, completely free. |
| stl-to-3mf | Upgrade your 3D printing files from legacy STL to the modern 3MF format with embedded units, build metadata, and ZIP-based packaging. |
| stl-to-glb | Turn STL meshes into web-optimized GLB files ready for Three.js, AR Quick Look, product configurators, and real-time 3D on the web. |
| obj-to-stl | Triangulate your Wavefront OBJ models into clean, manifold STL files ready for every 3D-printing slicer — no upload, no software, no limits. |
| obj-to-step | Convert Wavefront OBJ polygon meshes into STEP BREP solid bodies for CAD import, CNC programming, and mechanical engineering workflows. |
| obj-to-3mf | Package your Wavefront OBJ meshes into the 3MF printing format with proper units, XML structure, and optional color data — entirely in your browser. |
| obj-to-glb | Transform Wavefront OBJ meshes into self-contained GLB files with embedded textures and PBR materials — optimized for web, AR, and real-time rendering. |
| step-to-stl | Tessellate your STEP CAD solids into high-quality STL meshes tuned for 3D printing — free, private, and entirely in your browser. |
| step-to-obj | Tessellate STEP CAD geometry into Wavefront OBJ polygon meshes with smooth normals — ready for Blender, rendering pipelines, and game engines. |
| step-to-3mf | Tessellate your precise STEP CAD models directly into print-ready 3MF packages — with embedded units, XML metadata, and ZIP compression. |
| step-to-glb | Transform STEP CAD solids into web-optimized GLB files with PBR materials — perfect for product configurators, AR, and 3D web experiences. |
| 3mf-to-stl | Extract clean triangle meshes from 3MF packages and export them as universal STL files compatible with every 3D-printing slicer on the market. |
| 3mf-to-obj | Unpack 3MF archives and export the mesh as Wavefront OBJ — preserving vertex indexing and enabling texturing in Blender, Maya, and other DCC tools. |
| 3mf-to-step | Convert 3MF printing meshes into STEP BREP solid bodies for CAD import — enabling measurement, sectioning, and integration with engineering tools. |
| 3mf-to-glb | Transform 3MF printing files into web-optimized GLB — mapping vertex colors to PBR materials for browser-based 3D viewers and AR experiences. |
| glb-to-stl | Extract raw triangle geometry from GLB files and export print-ready STL meshes — stripping materials, animations, and scene data down to pure geometry. |
| glb-to-obj | Convert glTF binary files into Wavefront OBJ meshes with UV coordinates and material references — for Blender, Maya, and legacy 3D pipelines. |
| glb-to-step | Wrap GLB polygon meshes into STEP solid bodies for import into SolidWorks, Fusion 360, and other CAD tools — entirely in your browser. |
| glb-to-3mf | Convert web-ready GLB files into 3MF printing packages — mapping PBR base colors to 3MF materials for full-color 3D printing workflows. |
| iges-to-stl | Tessellate legacy IGES CAD surfaces into clean, slicer-ready STL triangle meshes — breathing new life into archived engineering data. |
| iges-to-obj | Tessellate legacy IGES CAD geometry into Wavefront OBJ polygon meshes with smooth normals — for rendering, animation, and creative 3D workflows. |
| iges-to-step | Upgrade legacy IGES CAD data to the modern ISO 10303 STEP standard — preserving BREP surface geometry for SolidWorks, Fusion 360, and FreeCAD. |
| iges-to-3mf | Bridge decades-old IGES CAD archives directly to the modern 3MF printing format — tessellating NURBS surfaces into print-ready packages with units and metadata. |
| iges-to-glb | Transform legacy IGES CAD data into web-ready GLB files — making decades-old engineering designs viewable in any browser, AR app, or game engine. |

---

## 10. Content Section Headings (H2s)

### Intro Headings (25 unique)

| Slug | Intro Heading |
|------|--------------|
| stl-to-obj | Why Convert STL to OBJ? |
| stl-to-step | Bridging the Gap Between Mesh and CAD |
| stl-to-3mf | STL Is Showing Its Age — 3MF Is the Future of 3D Printing |
| stl-to-glb | From 3D Printing to the Web: STL Meets GLB |
| obj-to-stl | Preparing OBJ Files for 3D Printing |
| obj-to-step | Moving Polygon Meshes into the CAD World |
| obj-to-3mf | Bringing OBJ Assets to Modern 3D Printing |
| obj-to-glb | Why OBJ to GLB Is the Most Important Web-3D Conversion |
| step-to-stl | The Essential CAD-to-Print Pipeline |
| step-to-obj | From Engineering CAD to Creative 3D Pipelines |
| step-to-3mf | Straight from CAD to the Print Bed |
| step-to-glb | Publish CAD Models to the Web Instantly |
| 3mf-to-stl | When You Need the Simplicity of STL |
| 3mf-to-obj | Opening 3MF Models in Creative Software |
| 3mf-to-step | From the Print Bed Back to the CAD Desk |
| 3mf-to-glb | Showcase Your 3D Prints on the Web |
| glb-to-stl | From Screen to Print: Extracting Geometry from GLB |
| glb-to-obj | Bridging glTF and Legacy DCC Pipelines |
| glb-to-step | Reverse-Engineering Web 3D for CAD |
| glb-to-3mf | Print What You See on Screen |
| iges-to-stl | Unlocking Legacy CAD Archives for 3D Printing |
| iges-to-obj | Visualizing Legacy Engineering Data |
| iges-to-step | Modernizing Legacy CAD: IGES to STEP Migration |
| iges-to-3mf | Legacy CAD Meets Modern Additive Manufacturing |
| iges-to-glb | Putting Legacy CAD on the Web |

### How It Works Headings (25 unique)

| Slug | Heading |
|------|---------|
| stl-to-obj | How the STL to OBJ Conversion Works |
| stl-to-step | How STL to STEP Conversion Works |
| stl-to-3mf | How the Conversion Process Works |
| stl-to-glb | Under the Hood of STL to GLB |
| obj-to-stl | How OBJ to STL Triangulation Works |
| obj-to-step | The OBJ to STEP Pipeline |
| obj-to-3mf | How OBJ to 3MF Conversion Works |
| obj-to-glb | How the OBJ to GLB Pipeline Works |
| step-to-stl | How STEP Tessellation Produces STL Triangles |
| step-to-obj | How STEP to OBJ Tessellation Works |
| step-to-3mf | How STEP to 3MF Conversion Works |
| step-to-glb | The STEP to GLB Pipeline |
| 3mf-to-stl | How 3MF to STL Extraction Works |
| 3mf-to-obj | How the Conversion Pipeline Works |
| 3mf-to-step | How 3MF to STEP Wrapping Works |
| 3mf-to-glb | How 3MF to GLB Conversion Works |
| glb-to-stl | How GLB to STL Extraction Works |
| glb-to-obj | How the GLB to OBJ Pipeline Works |
| glb-to-step | How GLB Meshes Become STEP Solids |
| glb-to-3mf | How GLB to 3MF Conversion Works |
| iges-to-stl | How IGES Surfaces Become STL Triangles |
| iges-to-obj | The IGES to OBJ Pipeline |
| iges-to-step | How IGES to STEP Translation Works |
| iges-to-3mf | How IGES to 3MF Conversion Works |
| iges-to-glb | How IGES Becomes Web-Ready GLB |

### Format Notes Headings (25 unique — anti-duplicate differentiator)

| Slug | Heading |
|------|---------|
| stl-to-obj | Technical Notes: STL vs. OBJ Geometry |
| stl-to-step | Understanding the Faceted BREP Limitation |
| stl-to-3mf | What 3MF Adds Over STL |
| stl-to-glb | GLB Binary Efficiency vs. STL |
| obj-to-stl | What Gets Lost When You Convert OBJ to STL |
| obj-to-step | Faceted BREP: Capabilities and Constraints |
| obj-to-3mf | Color Handling and Material Mapping |
| obj-to-glb | Texture Embedding and PBR Material Mapping |
| step-to-stl | Tessellation Quality: Chord Tolerance and Angular Deflection |
| step-to-obj | Blender and DCC Pipeline Compatibility |
| step-to-3mf | What Changes When CAD Becomes a Print File |
| step-to-glb | PBR Materials from CAD Surfaces |
| 3mf-to-stl | What Gets Removed in the Conversion |
| 3mf-to-obj | Vertex Structure and Material Considerations |
| 3mf-to-step | Faceted Solid Limitations for CAD Workflows |
| 3mf-to-glb | Color-to-PBR Mapping |
| glb-to-stl | What Gets Stripped from GLB |
| glb-to-obj | Texture Extraction and UV Preservation |
| glb-to-step | Mesh-to-BREP Wrapping Challenges |
| glb-to-3mf | PBR-to-Print Color Mapping |
| iges-to-stl | Handling Legacy IGES Surface Types |
| iges-to-obj | NURBS-to-Polygon Surface Sampling |
| iges-to-step | Entity Mapping Between IGES and STEP |
| iges-to-3mf | Bridging Two Eras of Manufacturing Data |
| iges-to-glb | From CAD Precision to Web Performance |

### Use Cases Headings (25 unique)

| Slug | Heading |
|------|---------|
| stl-to-obj | Common Use Cases |
| stl-to-step | When to Use STL to STEP |
| stl-to-3mf | Who Benefits from STL to 3MF Conversion? |
| stl-to-glb | Popular STL to GLB Scenarios |
| obj-to-stl | When You Need OBJ to STL |
| obj-to-step | Typical OBJ to STEP Workflows |
| obj-to-3mf | Who Converts OBJ to 3MF? |
| obj-to-glb | Real-World OBJ to GLB Applications |
| step-to-stl | Who Converts STEP to STL? |
| step-to-obj | Common STEP to OBJ Scenarios |
| step-to-3mf | When to Convert STEP to 3MF |
| step-to-glb | STEP to GLB in Practice |
| 3mf-to-stl | Common 3MF to STL Scenarios |
| 3mf-to-obj | Who Converts 3MF to OBJ? |
| 3mf-to-step | When to Convert 3MF to STEP |
| 3mf-to-glb | Use Cases for 3MF to GLB |
| glb-to-stl | Popular GLB to STL Workflows |
| glb-to-obj | When to Convert GLB to OBJ |
| glb-to-step | GLB to STEP Use Cases |
| glb-to-3mf | Who Converts GLB to 3MF? |
| iges-to-stl | IGES to STL in Industry |
| iges-to-obj | Use Cases for IGES to OBJ |
| iges-to-step | Why Migrate from IGES to STEP? |
| iges-to-3mf | IGES to 3MF Use Cases |
| iges-to-glb | IGES to GLB Applications |

---

## 11. Supporting Keywords — Full Map

Every supporting keyword from Ahrefs research is confirmed present in the page's body text, meta description, title, or headings.

| Slug | Supporting Keywords (all confirmed present) |
|------|---------------------------------------------|
| stl-to-obj | stl to obj converter · convert stl to obj · how to convert stl to obj · stl to obj file converter |
| stl-to-step | stl to step converter · stl to step file converter · convert stl to step · how to convert stl to step · stl to step file |
| stl-to-3mf | stl to 3mf converter · convert stl to 3mf · how to convert stl to 3mf · stl to 3mf converter online · convert stl to 3mf free |
| stl-to-glb | stl to glb converter · stl to glb converter online |
| obj-to-stl | obj to stl converter · how to convert obj to stl · .obj to stl · 3d obj to stl |
| obj-to-step | obj to step converter · obj to step file · obj to step converter online · obj to step converter online free |
| obj-to-3mf | obj to 3mf converter · convert obj to 3mf · obj to 3mf converter online · obj to 3mf with color |
| obj-to-glb | obj to glb converter · obj to glb converter with texture · convert obj to glb · online obj to glb converter · obj to glb file converter |
| step-to-stl | step to stl converter · convert step to stl · .step to stl · step to stl converter free online |
| step-to-obj | step to obj converter · .step to obj · step to obj converter online free · .step to obj converter · step to obj blender |
| step-to-3mf | convert step to 3mf · .step to 3mf |
| step-to-glb | step to glb converter · step to glb converter online · .step to glb |
| 3mf-to-stl | convert 3mf to stl · 3mf to stl converter · .3mf to stl · .3mf to stl converter · convert 3mf to stl online free · 3mf to stl file |
| 3mf-to-obj | 3mf to obj converter · convert 3mf to obj · .3mf to obj converter · 3mf to obj converter online |
| 3mf-to-step | convert 3mf to step · 3mf to step converter · 3mf to step converter online · 3mf to step file converter |
| 3mf-to-glb | 3mf to glb converter |
| glb-to-stl | glb to stl converter · convert glb to stl · glb to stl file converter · convert glb to stl online free · .glb to stl |
| glb-to-obj | glb to obj converter · glb to obj with texture · .glb to obj · free online glb to obj converter · convert glb to obj |
| glb-to-step | glb to step converter · .glb to step · glb to step online |
| glb-to-3mf | glb to 3mf converter · glb to 3mf with color · convert glb to 3mf |
| iges-to-stl | convert iges to stl · converting iges to stl · iges to stl converter online |
| iges-to-obj | convert iges to obj |
| iges-to-step | iges to step converter · iges to step converter online · iges to step file converter |
| iges-to-3mf | convert iges to 3mf · iges to 3mf converter |
| iges-to-glb | iges to glb |

---

## 12. Word Count Report

Content-only word count (introText + howItWorksText + formatNotesText + useCasesText):

| Slug | Words | Status |
|------|-------|--------|
| stl-to-obj | 585 | ✅ |
| stl-to-step | 584 | ✅ |
| stl-to-3mf | 562 | ✅ |
| stl-to-glb | 514 | ✅ |
| obj-to-stl | 542 | ✅ |
| obj-to-step | 474 | ✅ |
| obj-to-3mf | 498 | ✅ |
| obj-to-glb | 529 | ✅ |
| step-to-stl | 492 | ✅ |
| step-to-obj | 469 | ✅ |
| step-to-3mf | 424 | ✅ |
| step-to-glb | 426 | ✅ |
| 3mf-to-stl | 429 | ✅ |
| 3mf-to-obj | 377 | ✅ |
| 3mf-to-step | 376 | ✅ |
| 3mf-to-glb | 360 | ✅ |
| glb-to-stl | 468 | ✅ |
| glb-to-obj | 447 | ✅ |
| glb-to-step | 397 | ✅ |
| glb-to-3mf | 419 | ✅ |
| iges-to-stl | 431 | ✅ |
| iges-to-obj | 405 | ✅ |
| iges-to-step | 465 | ✅ |
| iges-to-3mf | 445 | ✅ |
| iges-to-glb | 475 | ✅ |

**Range:** 360 – 585 words  
**All pages ≥350 words:** ✅  
**All pages ≥300 words:** ✅  
**Total content words across all 25 pages:** ~11,500+  
**Homepage content:** ~1,286 words  

---

## 13. Internal Linking Strategy

### Homepage → Converter pages
- **"All Supported Conversions"** grid with 25 links organized by source format (6 columns: STL, OBJ, STEP, 3MF, GLB, IGES)
- Each link: `<a href="/{slug}">{FromLabel} to {ToLabel}</a>`

### Converter page → Converter pages
Each converter page has a **"Related Conversions"** section with:

1. **Reverse conversion** (if exists) — e.g., STL→OBJ page links to OBJ→STL
2. **Same-source conversions** — e.g., STL→OBJ page links to STL→STEP, STL→3MF, STL→GLB
3. **"All Conversions" CTA** — links back to homepage

This creates a dense internal link mesh where:
- Every converter page links back to the homepage
- Every converter page links to 4–5 related converter pages
- The homepage links to all 25 converter pages

### Converter page → Homepage
- Breadcrumb: `3D Converter / {From} to {To}` — first crumb links to `/`
- "All Conversions" button at bottom of related conversions section

---

## 14. Structured Data (JSON-LD)

### Homepage (3 blocks)

```json
// Block 1: WebApplication
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "3D Model File Converter",
  "url": "https://3dmodelfileconverter.com",
  "applicationCategory": "DesignApplication",
  "operatingSystem": "Any (browser-based)",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "browserRequirements": "Requires a modern browser with WebAssembly support",
  "featureList": ["STL to OBJ conversion", "STL to STEP conversion", /* ... all 25 + 4 features */]
}

// Block 2: WebSite with SearchAction
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "3D Model File Converter",
  "url": "https://3dmodelfileconverter.com",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://3dmodelfileconverter.com/?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
}

// Block 3: Organization
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "3D Model File Converter",
  "url": "https://3dmodelfileconverter.com",
  "logo": "https://3dmodelfileconverter.com/favicon.svg",
  "contactPoint": {
    "@type": "ContactPoint",
    "email": "hello@3dmodelfileconverter.com",
    "contactType": "customer support"
  }
}
```

### Converter pages (2 blocks each)

```json
// Block 1: WebApplication (per-conversion)
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "{From} to {To} Converter",
  "url": "https://3dmodelfileconverter.com/{slug}",
  "applicationCategory": "DesignApplication",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
  "featureList": ["{From} to {To} conversion", "100% client-side processing", /* ... */],
  "isPartOf": {
    "@type": "WebSite",
    "name": "3D Model File Converter",
    "url": "https://3dmodelfileconverter.com"
  }
}

// Block 2: BreadcrumbList
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "3D Model File Converter", "item": "https://3dmodelfileconverter.com" },
    { "@type": "ListItem", "position": 2, "name": "{From} to {To}", "item": "https://3dmodelfileconverter.com/{slug}" }
  ]
}
```

### Visible breadcrumb (HTML microdata)

In addition to JSON-LD, each converter page has a **visible breadcrumb** nav with `itemscope itemtype="https://schema.org/BreadcrumbList"` microdata attributes.

---

## 15. Open Graph & Twitter Cards

Every page gets the following via `Layout.astro`:

| Property | Value |
|----------|-------|
| `og:type` | `website` |
| `og:url` | Canonical URL |
| `og:title` | Page-specific OG title |
| `og:description` | Page meta description |
| `og:image` | `https://3dmodelfileconverter.com/og-image.png` (1200×630px) |
| `og:image:width` | `1200` |
| `og:image:height` | `630` |
| `og:image:alt` | `3D Model File Converter — Free online tool to convert STL, OBJ, STEP, 3MF, GLB, and IGES files` |
| `og:site_name` | `3D Model File Converter` |
| `og:locale` | `en_US` |
| `twitter:card` | `summary_large_image` |
| `twitter:title` | Same as OG title |
| `twitter:description` | Same as OG description |
| `twitter:image` | Same as OG image |

---

## 16. Canonical URLs & Duplicate Handling

### Converter pages
Each converter page sets its canonical via the `canonicalPath` prop:
```
canonicalPath={`/${pageSlug}`}
```
Resolves to: `https://3dmodelfileconverter.com/{slug}`

### Alias pages (duplicate prevention)
Four information pages have alias URLs that render the same content. Each alias sets `canonicalPath` to the primary URL:

| Alias URL | Canonical Points To |
|-----------|-------------------|
| `/about-us` | `/about` |
| `/contact-us` | `/contact` |
| `/privacy-policy` | `/privacy` |
| `/terms-and-conditions` | `/terms` |

The alias pages are simple Astro components that import and render the primary page component.

### Sitemap exclusion
Alias pages are excluded from the sitemap via the filter in `astro.config.mjs`:
```javascript
sitemap({
  filter: (page) =>
    !page.includes('/about-us') &&
    !page.includes('/contact-us') &&
    !page.includes('/privacy-policy') &&
    !page.includes('/terms-and-conditions'),
}),
```

---

## 17. Sitemap & Robots.txt

### Sitemap

Generated automatically by `@astrojs/sitemap` at build time.

- **URL:** `https://3dmodelfileconverter.com/sitemap-index.xml`
- **Pages included:** 30 (homepage + 25 converters + about + contact + privacy + terms)
- **Pages excluded:** 4 alias pages (about-us, contact-us, privacy-policy, terms-and-conditions)

Configuration in `astro.config.mjs`:
```javascript
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://3dmodelfileconverter.com',
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/about-us') &&
        !page.includes('/contact-us') &&
        !page.includes('/privacy-policy') &&
        !page.includes('/terms-and-conditions'),
    }),
  ],
});
```

### Robots.txt

**File:** `public/robots.txt`

```
User-agent: *
Allow: /

Sitemap: https://3dmodelfileconverter.com/sitemap-index.xml

# All conversions run client-side — no server-side content to block
```

---

## 18. OG Image

| Property | Value |
|----------|-------|
| **File** | `public/og-image.png` |
| **Source** | `public/og-image.svg` (vector source) |
| **Dimensions** | 1200 × 630 px |
| **Format** | PNG |
| **URL** | `https://3dmodelfileconverter.com/og-image.png` |
| **Used by** | All pages via `Layout.astro` |

---

## 19. Anti-Duplicate Content Strategy

With 25 pages sharing a similar topic ("convert format A to format B"), duplicate content is a serious risk. Here is how every page is differentiated:

### 1. Unique meta descriptions
No two meta descriptions share the same opening pattern. Each uses a different sentence structure, verb, and angle.

### 2. Unique intro angles
Each `introHeading` + `introText` approaches the topic differently:
- Problem statement ("STL has no concept of shared vertices...")
- Industry context ("Engineers design in STEP. Artists render in OBJ.")
- Format comparison ("3MF was created by the 3MF Consortium to solve...")
- Workflow scenario ("When an industrial design team needs marketing renders...")

### 3. Format notes — the primary differentiator
The `formatNotesText` on every page discusses technical details specific to that exact conversion pair:
- STL→OBJ: vertex deduplication, normal reconstruction, UV absence
- STL→STEP: faceted BREP limitations, feature tree absence
- OBJ→GLB: PBR material mapping from Phong (.mtl), texture embedding
- STEP→STL: chord tolerance, angular deflection parameters
- IGES→STEP: entity type mapping (128→BSplineSurface, etc.)

These cannot be template-swapped because they contain format-specific technical accuracy.

### 4. Conversion-category-aware content
Content respects the four conversion categories:
- **Mesh→Mesh** (STL↔OBJ, STL↔3MF, etc.): discusses polygon operations, triangulation, vertex merging
- **CAD→Mesh** (STEP→STL, IGES→OBJ, etc.): discusses tessellation, chord tolerance, surface sampling
- **Mesh→CAD** (STL→STEP, OBJ→STEP, etc.): discusses faceted BREP wrapping, sewing, limitations
- **CAD→CAD** (IGES→STEP): discusses lossless entity mapping, BREP preservation

### 5. Unique use cases per page
Each page's use cases mention different industries, tools, and workflows specific to that conversion.

---

## 20. What Was NOT Done (Out of Scope)

| Item | Reason |
|------|--------|
| FAQ sections | User explicitly stated "FAQ prompt will be given later" |
| Off-page SEO | Out of scope (backlinks, social signals, etc.) |
| Google Search Console setup | Requires site ownership verification |
| Google Analytics / GA4 | Not requested |
| Page speed optimization | Separate concern; Astro static output is already fast |
| Alt text for non-OG images | Site uses minimal images (emoji-based UI cards) |
| Hreflang tags | Site is English-only |
| Schema.org FAQPage | Deferred until FAQ content is written |
| AMP pages | Not applicable for this type of tool |
| Per-page OG images | All pages share one OG image; unique per-page images could be added later |

---

## 21. Files Modified — Complete List

| File | What was done |
|------|--------------|
| `src/layouts/Layout.astro` | Added canonical URLs, OG tags (og:title, og:description, og:image, og:url, og:site_name, og:locale, og:type), Twitter Cards, robots meta, JSON-LD support for single object and array |
| `src/pages/index.astro` | Rewrote with ~1,286 words of SEO content, 3 JSON-LD blocks (WebApplication, WebSite, Organization), internal linking grid |
| `src/pages/[slug].astro` | Full rewrite: dynamic SEO content rendering, 2 JSON-LD blocks per page, visible breadcrumb with microdata, related conversions internal linking, format-aware how-it-works cards |
| `src/data/seo-content.ts` | Created from scratch: 679 lines, 25 entries with unique content across all fields |
| `public/robots.txt` | Created: crawl directives + sitemap reference |
| `public/og-image.svg` | Created: vector source for OG image |
| `public/og-image.png` | Created: 1200×630 raster OG image |
| `astro.config.mjs` | Added `@astrojs/sitemap` integration with alias-page filter, added `site` property |
| `package.json` | Added `@astrojs/sitemap` dependency |

---

## 22. Audit Results — Final State

### Missing keywords: ✅ ZERO

All supporting keywords from Ahrefs research are confirmed present in each page's combined text (body + meta + headings + title).

### Meta description duplicates: ✅ ZERO

No two meta descriptions share the same first 3 words.

### Meta description lengths: ✅ ALL ≤ 160

Range: 140 – 160 characters.

### Word counts: ✅ ALL ≥ 350

Range: 360 – 585 words (content-only, excludes headings and meta).

### Build: ✅ SUCCESSFUL

```
34 page(s) built in 416ms
sitemap-index.xml created at dist
0 errors
```

### Sitemap: ✅ 30 URLs

All 25 converter pages + homepage + about + contact + privacy + terms. Alias pages correctly excluded.

---

> **Next step:** User will provide a separate FAQ prompt. When that happens, consider adding `FAQPage` schema markup and a visible FAQ section to each converter page.
