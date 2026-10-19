# PDF protection engine notices

Unmodified qpdf.js and qpdf.wasm come from pdfstudio 0.4.0, source commit c5c1f2d9f378199d1e2d333dbe4ca20e9ff737ad. The registry archive integrity and source Git-blob matches are recorded in manifest.json. The documented generated-module diagnostic observed QPDF 12.3.2. The wrapper and QPDF use Apache-2.0; their complete licenses and QPDF NOTICE are included here, including embedded cryptography attribution.

The retained WASM contains JPEG 9f and zlib 1.3.2 version labels. Their upstream license materials are retained as README.jpeg-9f.txt and LICENSE.zlib-1.3.2.txt. This software is based in part on the work of the Independent JPEG Group.

The exact compiler/runtime revision is unproved. Emscripten, musl, libc++ and libc++abi license materials are retained from the primary source reference commit recorded in manifest.json. This reference is distinct from an attested compiler build. LICENSE.emscripten.txt also contains the embedded Node path attribution. The complete materials are included without modification.

Sources: [pdfstudio pinned source](https://github.com/fayazara/pdfstudio/tree/c5c1f2d9f378199d1e2d333dbe4ca20e9ff737ad), [QPDF 12.3.2](https://github.com/qpdf/qpdf/tree/v12.3.2), [zlib 1.3.2](https://github.com/madler/zlib/tree/v1.3.2), [Emscripten reference and IJG archive pin](https://github.com/emscripten-core/emscripten/tree/30bbb45939d0136eae1637dd17146cc02ee1658f).
