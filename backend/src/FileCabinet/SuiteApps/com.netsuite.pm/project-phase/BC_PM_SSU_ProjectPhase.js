/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/url', 'N/runtime', 'N/query', 'N/file'], (url, runtime, query, file) => {

    let pathObj = {};

    function resolveSuiteletUrl(scriptId, deploymentId) {
        if (!scriptId || !deploymentId) return '';
        try {
            return url.resolveScript({
                scriptId: String(scriptId),
                deploymentId: String(deploymentId),
                returnExternalUrl: false
            }) || '';
        } catch (e) {
            console.log('Unable to resolve suitelet url', { scriptId, deploymentId, e });
            return '';
        }
    }

    /**
     * Function will handle the get request
     *
     * @governance 10 Units
     */
    function onRequest(context) {
        if (context.request.method === 'GET') {

            const coreFiles = getFileMeta(
                [
                    { name: 'index.js', path: 'SuiteApps : com.netsuite.pm : project-phase : dist : index.js' },
                    { name: 'style.css', path: 'SuiteApps : com.netsuite.pm : project-phase : dist : style.css' },
                ]
            ); // 10 units

            const styleUrl = coreFiles['style.css']?.url || '';
            const scriptUrl = coreFiles['index.js']?.url || '';

            // NetSuite serves File Cabinet assets via `/core/media/media.nl?...`.
            // Relative `url(./font.woff2)` inside CSS resolves to `/core/media/font.woff2` (404),
            // so we override MDI @font-face with absolute File Cabinet URLs.
            const mdiFontFaceCss = buildMdiFontFaceOverride(coreFiles['style.css']?.id);

            const handlerUrl = resolveSuiteletUrl('customscript_bc_pm_ssu_projectphase_hdl', 'customdeploy_bc_pm_ssu_projectphase_hdl');

            const htmlContent = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Project Phase Management</title>
                <script>
                    // Pass handler Suitelet URL to frontend via global variable
                    window.PM_PROJECT_PHASE_HANDLER_URL = ${JSON.stringify(handlerUrl)};
                </script>
                <script type="module" crossorigin src="${scriptUrl}"></script>
                <link rel="stylesheet" crossorigin href="${styleUrl}">
                ${mdiFontFaceCss ? `<style>${mdiFontFaceCss}</style>` : ''}
            </head>
            <body>
                <div id="app"></div>
            </body>
            </html>`

            return context.response.write(htmlContent);
        }
    }

    /**
    * Get file URLs + file ids from file paths
    * @param {array} fileArr - Array of file objects with name and path
    * @governance 10 units
    */
    function getFileMeta(fileArr) {
        let outputRes = {};

        // [
        //     { 
        //         name: 'xx.css' ,
        //         path: 'SuiteApps : com.netsuite.xx : ui : xx.css' 
        //     },
        // ]

        if (fileArr.length) {
            const sqlQuery = `
                SELECT 
                    f.id fileid,
                    f.isonline,
                    f.url,
                    f.filetype,
                    mif.appfolder || ' : ' || f.name as filepath
                FROM file f
                INNER JOIN mediaitemfolder mif ON mif.id = f.folder
                WHERE mif.appfolder || ' : ' || f.name IN (${fileArr.map(obj => `'${obj.path}'`).join(', ')})
            `;

            let resultSet = query.runSuiteQL({
                query: sqlQuery
            });

            let results = resultSet.asMappedResults(); // 10 units

            fileArr.forEach(p => {
                let isResFound = results.find(res => res.filepath == p.path);
                outputRes[p.name] = {
                    id: isResFound ? isResFound.fileid : '',
                    url: isResFound ? isResFound.url : ''
                };
            });
        }

        return outputRes;
    }

    function getFileUrl(fileArr) {
        const meta = getFileMeta(fileArr);
        const output = {};
        for (const [name, value] of Object.entries(meta)) output[name] = value.url || '';
        return output;
    }

    function buildMdiFontFaceOverride(styleFileId) {
        if (!styleFileId) return '';

        let styleContents = '';
        try {
            styleContents = file.load({ id: styleFileId }).getContents();
        } catch (e) {
            console.log('Unable to load style.css for MDI override', e);
            return '';
        }

        const mdiFiles = extractMdiFontFilenames(styleContents);
        if (!mdiFiles.length) return '';

        const urls = getFileUrl(
            mdiFiles.map(name => ({
                name,
                path: `SuiteApps : com.netsuite.pm : project-phase : dist : ${name}`
            }))
        );

        const eot = urls[mdiFiles.find(f => f.endsWith('.eot'))] || '';
        const woff2 = urls[mdiFiles.find(f => f.endsWith('.woff2'))] || '';
        const woff = urls[mdiFiles.find(f => f.endsWith('.woff'))] || '';
        const ttf = urls[mdiFiles.find(f => f.endsWith('.ttf'))] || '';

        if (!eot && !woff2 && !woff && !ttf) return '';

        const sources = [];
        if (eot) sources.push(`url(${eot}?#iefix) format("embedded-opentype")`);
        if (woff2) sources.push(`url(${woff2}) format("woff2")`);
        if (woff) sources.push(`url(${woff}) format("woff")`);
        if (ttf) sources.push(`url(${ttf}) format("truetype")`);

        return [
            '@font-face{',
            'font-family:"Material Design Icons";',
            eot ? `src:url(${eot});` : '',
            sources.length ? `src:${sources.join(',')};` : '',
            'font-weight:400;',
            'font-style:normal;',
            'font-display:block;',
            '}'
        ].filter(Boolean).join('');
    }

    function extractMdiFontFilenames(styleContents) {
        // Extracts `materialdesignicons-webfont-*.woff2/.woff/.ttf/.eot` referenced as `url(./<file>?v=...)`.
        const found = new Set();
        const re = /url\(\.\/(materialdesignicons-webfont-[^\)"']+)\)/g;
        let m;
        while ((m = re.exec(styleContents))) {
            const raw = m[1] || '';
            const name = raw.split('?')[0].trim();
            if (name) found.add(name);
        }

        // Prefer typical formats, but keep whatever we found.
        const prioritized = ['.eot', '.woff2', '.woff', '.ttf']
            .flatMap(ext => [...found].filter(f => f.endsWith(ext)));
        const rest = [...found].filter(f => !prioritized.includes(f));
        return [...prioritized, ...rest];
    }

    return { onRequest };
});
