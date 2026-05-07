#!/usr/bin/env node
/**
 * G.U.R.U. build script — extracts <script> blocks, minifies with terser,
 * inlines back into HTML, writes to public/index.html.
 * Source (index.html) stays readable for the GitHub repo.
 * Run: node build.js
 */
const fs      = require('fs');
const path    = require('path');
const { minify } = require('terser');

async function build() {
    const src  = fs.readFileSync('index.html', 'utf8');
    const dest = 'public/index.html';

    // Extract all <script> blocks (not CDN src= ones)
    const scriptRe = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
    let result = src;
    let match;
    const replacements = [];

    scriptRe.lastIndex = 0;
    while ((match = scriptRe.exec(src)) !== null) {
        const full = match[0];
        const code = match[1];
        if (code.trim().length < 50) continue; // skip tiny inline scripts
        replacements.push({ full, code });
    }

    for (const { full, code } of replacements) {
        try {
            const minified = await minify(code, {
                compress: { drop_console: false, passes: 2 },
                mangle:   { toplevel: false }, // keep function names for event handlers
                format:   { comments: false }
            });
            if (minified.code) {
                result = result.replace(full, `<script>${minified.code}</script>`);
            }
        } catch(e) {
            console.warn('Minify skipped a block:', e.message.slice(0, 80));
        }
    }

    // Minify inline <style> blocks (basic whitespace reduction)
    result = result.replace(/<style>([\s\S]*?)<\/style>/gi, (m, css) => {
        const mini = css
            .replace(/\/\*[\s\S]*?\*\//g, '')   // remove comments
            .replace(/\s{2,}/g, ' ')             // collapse whitespace
            .replace(/\s*([{}:;,>+~])\s*/g, '$1') // remove spaces around operators
            .trim();
        return `<style>${mini}</style>`;
    });

    fs.writeFileSync(dest, result, 'utf8');
    const srcSize  = (fs.statSync('index.html').size / 1024).toFixed(1);
    const destSize = (fs.statSync(dest).size / 1024).toFixed(1);
    console.log(`✓ Built public/index.html — ${srcSize}KB → ${destSize}KB`);
}

build().catch(e => { console.error(e); process.exit(1); });
