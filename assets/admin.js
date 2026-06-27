jQuery(document).ready(function ($) {
    // Estado local
    window.utpPostsData = [];
    let currentPage = 0;
    let totalPages = 1;
    let postsLoaded = false;

    function findPost(id) {
        return window.utpPostsData.find(p => p.id == id);
    }

    // Test API Connection
    $('#utp-test-api-btn').click(function (e) {
        e.preventDefault();
        let btn = $(this);
        let res = $('#utp-test-api-result');

        btn.prop('disabled', true).text('Probando...');
        res.css('color', '#555').text('Conectando con la API...');

        $.post(utpData.ajaxurl, {
            action: 'utp_test_api',
            nonce: utpData.nonce
        }, function (response) {
            btn.prop('disabled', false).text('Probar Conexión API');
            if (response.success) {
                res.css('color', 'green').text('✅ ' + response.data);
            } else {
                res.css('color', '#d63638').text('❌ Error: ' + response.data);
            }
        }).fail(function () {
            btn.prop('disabled', false).text('Probar Conexión API');
            res.css('color', '#d63638').text('❌ Error de red al intentar conectar.');
        });
    });

    // Tabs
    $('.utp-nav-tab-wrapper a').click(function (e) {
        e.preventDefault();
        $('.utp-nav-tab-wrapper a').removeClass('nav-tab-active');
        $(this).addClass('nav-tab-active');
        $('.utp-tab-content').hide();
        $($(this).attr('href')).show();

        if ($(this).attr('href') === '#utp-tab-database' && !postsLoaded) {
            loadPosts(1);
        }
        if ($(this).attr('href') === '#utp-tab-urls' && !window.urlsLoaded) {
            loadUrls(1);
        }
    });

    function updateLangCounts() {
        let counts = {};
        window.utpPostsData.forEach(p => {
            counts[p.detected_lang] = (counts[p.detected_lang] || 0) + 1;
        });

        let html = '';
        for (let lang in counts) {
            let label = lang === '?' ? 'Desconocido' : lang;
            let color = lang === '?' ? '#d63638' : '#2271b1';
            html += `<span style="display:inline-block; margin-right:12px; padding:4px 10px; background:#f0f0f1; border-radius:3px; border-left:3px solid ${color};">
                <strong>${label}:</strong> ${counts[lang]}
            </span>`;
        }
        $('#utp-lang-counts').html(html);
    }

    function loadPosts(page) {
        let btn = $('#utp-load-more-btn');
        btn.prop('disabled', true).text('Cargando...');

        let filterType = $('#utp-post-type-filter').val();

        $.post(utpData.ajaxurl, {
            action: 'utp_get_posts',
            nonce: utpData.nonce,
            paged: page,
            filter_type: filterType
        }, function (response) {
            btn.prop('disabled', false).text('Cargar más posts');
            if (!response.success) return;

            currentPage = response.data.paged;
            totalPages = response.data.total_pages;
            window.utpPostsData = window.utpPostsData.concat(response.data.posts);

            renderRows(response.data.posts, page > 1);
            updateLangCounts();
            postsLoaded = true;

            $('#utp-pagination-info').text(window.utpPostsData.length + ' de ' + response.data.total_posts + ' posts cargados');
            btn.toggle(currentPage < totalPages);
        });
    }

    $('#utp-load-more-btn').click(function () {
        loadPosts(currentPage + 1);
    });

    $('#utp-filter-btn').click(function () {
        window.utpPostsData = [];
        $('#utp-post-list').empty();
        postsLoaded = false;
        loadPosts(1);
    });

    // =========================================================
    // FILA PRINCIPAL DE CADA POST
    // =========================================================
    function rowHtml(post) {
        let safeTitle = $('<div>').text(post.title).html();
        let langBadge = post.detected_lang === '?'
            ? `<span style="color:#d63638; font-weight:bold;" title="Idioma desconocido">⚠️ ?</span>`
            : `<strong>${post.detected_lang}</strong>`;

        let backupBtn = post.has_backup
            ? `<button type="button" class="button utp-restore-btn" data-id="${post.id}" style="color:#d63638; border-color:#d63638;" title="Restaurar al texto original">↩ Restaurar</button>`
            : `<span style="color:#999; font-size:11px;">Sin backup</span>`;

        return `<tr class="utp-post-row" data-post-id="${post.id}">
            <th scope="row" class="check-column">
                <input type="checkbox" name="post_ids[]" value="${post.id}" class="utp-post-cb" ${post.detected_lang === '?' ? 'title="Idioma desconocido – escanear primero"' : ''}>
            </th>
            <td>${post.id}</td>
            <td><strong>${post.type}</strong></td>
            <td id="lang-cell-${post.id}">${langBadge}</td>
            <td><strong>${safeTitle}</strong></td>
            <td>
                <button type="button" class="button utp-toggle-fields-btn" data-id="${post.id}" data-open="0">
                    ▶ Ver campos
                </button>
                <button type="button" class="button utp-edit-btn" data-id="${post.id}" style="margin-left:4px;">✏️ Editor</button>
                <button type="button" class="button utp-quick-trans-btn" data-id="${post.id}" style="margin-left:4px;">🔄 Autotraducir</button>
            </td>
            <td>${backupBtn}</td>
        </tr>
        <tr class="utp-fields-row" id="fields-row-${post.id}" style="display:none; background:#fafafa;">
            <td colspan="7" style="padding:0;">
                <div class="utp-fields-accordion" id="fields-accordion-${post.id}" style="padding:12px 20px;">
                    <span style="color:#888;">Cargando campos...</span>
                </div>
            </td>
        </tr>`;
    }

    function renderRows(posts, append) {
        let html = posts.map(rowHtml).join('');
        if (append) {
            $('#utp-post-list').append(html);
        } else {
            $('#utp-post-list').html(html);
        }
    }

    // =========================================================
    // ACORDEÓN DE CAMPOS POR POST
    // =========================================================

    // Ícono según tipo de campo
    function fieldIcon(type) {
        switch (type) {
            case 'image': return '🖼️';
            case 'url': return '🔗';
            case 'json': return '{ }';
            default: return '📝';
        }
    }

    // Previsualización corta del valor
    function fieldPreview(value, type) {
        if (!value) return '';
        let safe = $('<div>').text(value).html();
        if (type === 'image') {
            return `<img src="${safe}" style="height:36px; width:auto; border-radius:3px; vertical-align:middle; margin-left:6px;" onerror="this.style.display='none'">`;
        }
        let truncated = value.length > 80 ? value.substring(0, 80) + '…' : value;
        return `<span style="color:#555; font-size:12px; margin-left:6px;">${$('<div>').text(truncated).html()}</span>`;
    }

    function renderFieldsAccordion(postId, detail) {
        let fieldsInfo = detail.fields_info || {};
        let html = `<div style="margin-bottom:8px; display:flex; align-items:center; gap:10px;">
            <strong style="font-size:13px;">Campos del Post #${postId}</strong>
            <button type="button" class="button button-small utp-select-all-fields" data-post="${postId}">✓ Seleccionar todos</button>
            <button type="button" class="button button-small utp-deselect-all-fields" data-post="${postId}">☐ Deseleccionar todos</button>
            <button type="button" class="button button-primary button-small utp-translate-selected-btn" data-id="${postId}" style="margin-left:auto;">
                🚀 Traducir Seleccionados
            </button>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">`;

        let fieldCount = 0;
        for (let key in fieldsInfo) {
            let field = fieldsInfo[key];
            let type = field.type || 'text';
            let isTranslatable = field.translatable !== false;
            let isDefault = isTranslatable; // marcado por defecto si es text/json
            let icon = fieldIcon(type);
            let preview = fieldPreview(field.value, type);
            let labelKey = key === '_utp_title' ? 'Título' : key === '_utp_content' ? 'Contenido' : key;
            let chipColor = type === 'image' ? '#fff3cd' : type === 'url' ? '#e8f4fd' : '#f0f0f0';
            let borderColor = type === 'image' ? '#ffc107' : type === 'url' ? '#2271b1' : '#ccc';

            html += `<label class="utp-field-chip" style="
                display:inline-flex; align-items:center; gap:6px;
                padding:6px 10px; border-radius:4px;
                background:${chipColor}; border:1px solid ${borderColor};
                cursor:pointer; font-size:12px; max-width:320px;
                ${!isTranslatable ? 'opacity:0.75;' : ''}
            " title="${type}">
                <input type="checkbox" 
                    class="utp-field-cb" 
                    data-post="${postId}" 
                    data-field="${key}"
                    ${isDefault ? 'checked' : ''}
                >
                <span>${icon}</span>
                <span style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:130px;" title="${labelKey}">${labelKey}</span>
                ${preview}
            </label>`;
            fieldCount++;
        }

        if (fieldCount === 0) {
            html += `<span style="color:#888; font-style:italic;">No hay campos traducibles para este post.</span>`;
        }

        html += `</div>`;
        $('#fields-accordion-' + postId).html(html);
    }

    // Click en "Ver campos"
    $(document).on('click', '.utp-toggle-fields-btn', function () {
        let btn = $(this);
        let postId = btn.data('id');
        let isOpen = btn.data('open') == 1;
        let row = $('#fields-row-' + postId);

        if (isOpen) {
            row.hide();
            btn.data('open', 0).text('▶ Ver campos');
            return;
        }

        // Si ya se cargaron los campos, solo mostrar
        if (btn.data('loaded')) {
            row.show();
            btn.data('open', 1).text('▼ Ocultar campos');
            return;
        }

        btn.prop('disabled', true).text('Cargando...');

        $.post(utpData.ajaxurl, {
            action: 'utp_get_post_detail',
            nonce: utpData.nonce,
            post_id: postId
        }, function (response) {
            btn.prop('disabled', false).text('▼ Ocultar campos');
            btn.data('open', 1).data('loaded', 1);
            if (!response.success) {
                $('#fields-accordion-' + postId).html('<span style="color:#d63638;">Error al cargar campos.</span>');
                row.show();
                return;
            }
            renderFieldsAccordion(postId, response.data);
            row.show();
        }).fail(function () {
            btn.prop('disabled', false).text('▶ Ver campos');
            alert('Error de red al cargar campos.');
        });
    });

    // Seleccionar / deseleccionar todos los campos de un post
    $(document).on('click', '.utp-select-all-fields', function () {
        let postId = $(this).data('post');
        $(`.utp-field-cb[data-post="${postId}"]`).prop('checked', true);
    });
    $(document).on('click', '.utp-deselect-all-fields', function () {
        let postId = $(this).data('post');
        $(`.utp-field-cb[data-post="${postId}"]`).prop('checked', false);
    });

    // Traducir campos seleccionados desde el acordeón
    $(document).on('click', '.utp-translate-selected-btn', function () {
        let btn = $(this);
        let postId = btn.data('id');
        let targetLang = $('#utp-target-lang').val();

        let fieldsToTranslate = [];
        $(`.utp-field-cb[data-post="${postId}"]:checked`).each(function () {
            fieldsToTranslate.push($(this).data('field'));
        });

        if (fieldsToTranslate.length === 0) {
            alert('Selecciona al menos un campo para traducir.');
            return;
        }

        let fieldLabels = fieldsToTranslate.map(f => f === '_utp_title' ? 'Título' : f === '_utp_content' ? 'Contenido' : f).join(', ');
        if (!confirm(`Se traducirán ${fieldsToTranslate.length} campo(s): ${fieldLabels}\nIdioma destino: ${targetLang}\n¿Continuar?`)) return;

        btn.prop('disabled', true).text('Traduciendo...');

        $.post(utpData.ajaxurl, {
            action: 'utp_auto_translate',
            nonce: utpData.nonce,
            post_id: postId,
            target_lang: targetLang,
            fields_to_translate: fieldsToTranslate
        }, function (response) {
            btn.prop('disabled', false).text('🚀 Traducir Seleccionados');
            if (response.success) {
                let post = findPost(postId);
                if (post) {
                    post.detected_lang = targetLang;
                    if (fieldsToTranslate.includes('_utp_title')) {
                        post.title = response.data.title;
                    }
                    $('#lang-cell-' + postId).html('<strong>' + targetLang + '</strong>');
                    updateLangCounts();
                }
                // Marcar backup disponible
                let restoreCell = $(`.utp-restore-btn[data-id="${postId}"]`);
                if (restoreCell.length === 0) {
                    // Actualizar la celda de backup si era "Sin backup"
                    $(`.utp-post-row[data-post-id="${postId}"] td:last-child`).html(
                        `<button type="button" class="button utp-restore-btn" data-id="${postId}" style="color:#d63638; border-color:#d63638;">↩ Restaurar</button>`
                    );
                }
                alert('¡Campos traducidos exitosamente!');
            } else {
                alert('Error de API: ' + (response.data || 'Revisa tu API Key'));
            }
        }).fail(function () {
            btn.prop('disabled', false).text('🚀 Traducir Seleccionados');
            alert('Error de red o timeout del servidor.');
        });
    });

    // =========================================================
    // LANGUAGE SCAN (Mejorado – muestra progreso detallado)
    // =========================================================
    $('#utp-scan-langs-btn').click(function () {
        let toScan = window.utpPostsData.filter(p => p.detected_lang === '?');
        if (toScan.length === 0) {
            alert('Todos los posts ya tienen el idioma detectado.');
            return;
        }

        if (!confirm(`Se escanearán ${toScan.length} posts usando la API (con filtrado inteligente de stop-words). ¿Deseas continuar?`)) return;

        let btn = $(this);
        btn.prop('disabled', true).text('Escaneando...');

        let completed = 0;
        let unknown = 0;

        function scanNext() {
            if (completed + unknown >= toScan.length) {
                btn.prop('disabled', false).text('Escanear Idiomas Desconocidos (API)');
                alert(`Escaneo completado.\n✅ Detectados: ${completed}\n❓ Siguen desconocidos: ${unknown}`);
                updateLangCounts();
                updateEstimator();
                return;
            }

            let post = toScan[completed + unknown];
            $.post(utpData.ajaxurl, {
                action: 'utp_detect_language',
                nonce: utpData.nonce,
                post_id: post.id
            }, function (response) {
                if (response.success && response.data !== 'UNKNOWN') {
                    post.detected_lang = response.data;
                    $('#lang-cell-' + post.id).html('<strong>' + post.detected_lang + '</strong>');
                    completed++;
                } else {
                    unknown++;
                }
                btn.text(`Escaneando... (${completed + unknown}/${toScan.length}) ✅${completed} ❓${unknown}`);
                scanNext();
            }).fail(function () {
                unknown++;
                scanNext();
            });
        }
        scanNext();
    });

    // =========================================================
    // LANGUAGE RE-SCAN (Volver a escanear todos los posts cargados)
    // =========================================================
    $('#utp-rescan-langs-btn').click(function () {
        let toScan = window.utpPostsData;
        if (toScan.length === 0) {
            alert('No hay posts cargados en la lista para escanear.');
            return;
        }

        if (!confirm(`Se volverá a escanear el idioma de los ${toScan.length} posts cargados usando la API, lo cual sobrescribirá el idioma guardado. ¿Deseas continuar?`)) return;

        let btn = $(this);
        btn.prop('disabled', true).text('Re-escaneando...');

        let completed = 0;
        let unknown = 0;

        function scanNext() {
            if (completed + unknown >= toScan.length) {
                btn.prop('disabled', false).text('Re-escanear Todos los Idiomas (API)');
                alert(`Re-escaneo completado.\n✅ Detectados: ${completed}\n❓ Siguen desconocidos: ${unknown}`);
                updateLangCounts();
                updateEstimator();
                return;
            }

            let post = toScan[completed + unknown];
            $.post(utpData.ajaxurl, {
                action: 'utp_detect_language',
                nonce: utpData.nonce,
                post_id: post.id
            }, function (response) {
                if (response.success && response.data !== 'UNKNOWN') {
                    post.detected_lang = response.data;
                    $('#lang-cell-' + post.id).html('<strong>' + post.detected_lang + '</strong>');
                    completed++;
                } else {
                    unknown++;
                }
                btn.text(`Re-escaneando... (${completed + unknown}/${toScan.length}) ✅${completed} ❓${unknown}`);
                scanNext();
            }).fail(function () {
                unknown++;
                scanNext();
            });
        }
        scanNext();
    });

    // =========================================================
    // ESTIMADOR DE COSTOS
    // Excluye posts con idioma '?' (desconocido) con advertencia
    // =========================================================
    function updateEstimator() {
        let selectedIds = [];
        let skippedSameLang = 0;
        let skippedUnknown = 0;
        let totalChars = 0;
        let targetLang = $('#utp-target-lang').val();

        $('.utp-post-cb:checked').each(function () {
            let post = findPost($(this).val());
            if (!post) return;

            if (post.detected_lang === '?') {
                skippedUnknown++;
            } else if (post.detected_lang === targetLang) {
                skippedSameLang++;
            } else {
                selectedIds.push(post.id);
                totalChars += post.chars || 0;
            }
        });

        window.utpValidIdsToTranslate = selectedIds;
        $('#utp-export-btn').prop('disabled', $('.utp-post-cb:checked').length === 0);

        let omitParts = [];
        if (skippedSameLang > 0) {
            omitParts.push(`<span style="color:#d63638">${skippedSameLang} ya en ${targetLang}</span>`);
        }
        if (skippedUnknown > 0) {
            omitParts.push(`<span style="color:#e07914">⚠️ ${skippedUnknown} idioma desconocido (escanear primero)</span>`);
        }

        if (selectedIds.length > 0) {
            let rate = (utpData.rates && utpData.rates[utpData.apiType]) || 0;
            let cost = (totalChars * rate).toFixed(4);
            let omitTxt = omitParts.length > 0 ? ` &nbsp;|&nbsp; ` + omitParts.join(' &nbsp;|&nbsp; ') : '';

            $('#utp-char-count').html(totalChars.toLocaleString() + omitTxt);
            $('#utp-cost-estimate').text('$' + cost + ' (' + utpData.apiType + ')');
            $('#utp-auto-translate-btn').prop('disabled', false).text('Traducir ' + selectedIds.length + ' Posts (API)');
        } else {
            let emptyMsg = '0';
            if (skippedSameLang > 0 || skippedUnknown > 0) {
                emptyMsg = omitParts.join(' &nbsp;|&nbsp; ');
            }
            $('#utp-char-count').html(emptyMsg);
            $('#utp-cost-estimate').text('$0.00');
            $('#utp-auto-translate-btn').prop('disabled', true).text('Traducir Seleccionados (API)');
        }
    }

    $(document).on('change', '.utp-post-cb, #cb-select-all', function () {
        if ($(this).attr('id') === 'cb-select-all') {
            $('.utp-post-cb').prop('checked', $(this).prop('checked'));
        }
        updateEstimator();
    });

    $('#utp-target-lang').change(function () {
        if ($('.utp-post-cb:checked').length > 0) {
            updateEstimator();
        }
    });

    // =========================================================
    // MODAL EDITOR MANUAL
    // =========================================================
    function buildRow(label, key, originalVal, isTextarea) {
        let escapedVal = $('<div>').text(originalVal).html();
        let inputHtml = isTextarea
            ? `<textarea class="widefat utp-meta-input" data-key="${key}" rows="4">${escapedVal}</textarea>`
            : `<input type="text" class="widefat utp-meta-input" data-key="${key}" value="${escapedVal}" />`;

        return `
        <div class="utp-editor-split">
            <div class="utp-editor-left">
                <h3>Original: ${label}</h3>
                <div class="utp-original-box">${escapedVal}</div>
            </div>
            <div class="utp-editor-right">
                <h3>Traducción</h3>
                ${inputHtml}
            </div>
        </div><hr/>`;
    }

    $(document).on('click', '.utp-edit-btn', function () {
        let id = $(this).data('id');
        let btn = $(this);

        btn.prop('disabled', true).text('Cargando...');

        $.post(utpData.ajaxurl, {
            action: 'utp_get_post_detail',
            nonce: utpData.nonce,
            post_id: id
        }, function (response) {
            btn.prop('disabled', false).text('✏️ Editor');
            if (!response.success) {
                alert('Error: ' + response.data);
                return;
            }

            let detail = response.data;
            $('#utp-edit-post-id').val(detail.id);

            let html = '<h2 style="margin-top:0; border-bottom:1px solid #ccc; padding-bottom:5px;">Campos Principales</h2>';
            html += buildRow('Título', '_utp_title', detail.title, false);
            html += buildRow('Contenido', '_utp_content', detail.content, true);

            if (detail.meta && Object.keys(detail.meta).length > 0) {
                html += '<h2 style="margin-top:30px; border-bottom:1px solid #ccc; padding-bottom:5px;">Campos Personalizados (Meta)</h2>';
                for (let metaKey in detail.meta) {
                    let metaVal = detail.meta[metaKey];
                    let isTextarea = metaVal.length > 80 || metaVal.includes('\n');
                    html += buildRow(metaKey, metaKey, metaVal, isTextarea);
                }
            }

            $('#utp-dynamic-fields-container').html(html);
            $('#utp-manual-editor-modal').show();
        }).fail(function () {
            btn.prop('disabled', false).text('✏️ Editor');
            alert('Error de red al cargar el post.');
        });
    });

    $('.utp-close-modal').click(function () {
        $('#utp-manual-editor-modal').hide();
    });

    // Save Manual Translation
    $('#utp-btn-save-manual').click(function () {
        let btn = $(this);
        btn.prop('disabled', true).text('Guardando...');

        let post_id = $('#utp-edit-post-id').val();
        let title = '';
        let content = '';
        let meta = {};

        $('.utp-meta-input').each(function () {
            let key = $(this).data('key');
            let val = $(this).val();
            if (key === '_utp_title') {
                title = val;
            } else if (key === '_utp_content') {
                content = val;
            } else {
                meta[key] = val;
            }
        });

        $.post(utpData.ajaxurl, {
            action: 'utp_save_manual_translation',
            nonce: utpData.nonce,
            post_id: post_id,
            title: title,
            content: content,
            meta: meta
        }, function (response) {
            btn.prop('disabled', false).text('Guardar Permanentemente');
            if (response.success) {
                let post = findPost(post_id);
                if (post) post.title = title;
                $('#utp-manual-editor-modal').hide();
                alert('Guardado exitoso.');
            } else {
                alert('Error: ' + response.data);
            }
        });
    });

    // =========================================================
    // AUTO-TRADUCIR INDIVIDUAL (botón rápido de la tabla)
    // =========================================================
    $(document).on('click', '.utp-quick-trans-btn, #utp-btn-auto-fill', function () {
        let btn = $(this);
        let isModal = btn.attr('id') === 'utp-btn-auto-fill';
        let id = isModal ? $('#utp-edit-post-id').val() : btn.data('id');
        let targetLang = $('#utp-target-lang').val();

        let post = findPost(id);
        if (!isModal && post && post.detected_lang === targetLang) {
            if (!confirm(`Este post ya está marcado como ${targetLang}. ¿Estás seguro de querer traducirlo de nuevo y gastar tokens?`)) {
                return;
            }
        }

        btn.prop('disabled', true).text('Traduciendo...');

        $.post(utpData.ajaxurl, {
            action: 'utp_auto_translate',
            nonce: utpData.nonce,
            post_id: id,
            target_lang: targetLang
            // Sin fields_to_translate = traducir todo
        }, function (response) {
            btn.prop('disabled', false).text(isModal ? 'Autotraducir todos estos campos (API)' : '🔄 Autotraducir');
            if (response.success) {
                if (isModal) {
                    $('.utp-meta-input[data-key="_utp_title"]').val(response.data.title);
                    $('.utp-meta-input[data-key="_utp_content"]').val(response.data.content);
                    for (let metaKey in response.data.meta) {
                        $('.utp-meta-input[data-key="' + metaKey + '"]').val(response.data.meta[metaKey]);
                    }
                } else {
                    if (post) {
                        post.detected_lang = targetLang;
                        post.title = response.data.title;
                        $('#lang-cell-' + post.id).html('<strong>' + targetLang + '</strong>');
                        // Marcar que ahora tiene backup
                        let restoreCell = $(`.utp-restore-btn[data-id="${post.id}"]`);
                        if (restoreCell.length === 0) {
                            $(`.utp-post-row[data-post-id="${post.id}"] td:last-child`).html(
                                `<button type="button" class="button utp-restore-btn" data-id="${post.id}" style="color:#d63638; border-color:#d63638;">↩ Restaurar</button>`
                            );
                        }
                        updateLangCounts();
                    }
                    alert('¡Traducido permanentemente!');
                }
            } else {
                alert('Error de API: ' + (response.data || 'Revisa tu API Key'));
            }
        }).fail(function () {
            btn.prop('disabled', false).text(isModal ? 'Autotraducir todos estos campos (API)' : '🔄 Autotraducir');
            alert('Error de red o timeout del servidor.');
        });
    });

    // =========================================================
    // RESTAURAR BACKUP
    // =========================================================
    $(document).on('click', '.utp-restore-btn', function () {
        let btn = $(this);
        let id = btn.data('id');

        if (!confirm('¿Estás seguro de que deseas deshacer la traducción y restaurar el texto original de este elemento? Esto sobrescribirá la versión actual.')) return;

        btn.prop('disabled', true).text('Restaurando...');

        $.post(utpData.ajaxurl, {
            action: 'utp_restore_backup',
            nonce: utpData.nonce,
            post_id: id
        }, function (response) {
            btn.prop('disabled', false).text('↩ Restaurar');
            if (response.success) {
                alert(response.data);
                window.utpPostsData = [];
                $('#utp-post-list').empty();
                postsLoaded = false;
                loadPosts(1);
            } else {
                alert('Error al restaurar: ' + response.data);
            }
        }).fail(function () {
            btn.prop('disabled', false).text('↩ Restaurar');
            alert('Error de red.');
        });
    });

    // =========================================================
    // TRADUCCIÓN MASIVA (Batch)
    // =========================================================
    $('#utp-auto-translate-btn').click(function () {
        let selectedIds = window.utpValidIdsToTranslate || [];

        if (selectedIds.length === 0) return;

        let targetLang = $('#utp-target-lang').val();
        let costText = $('#utp-cost-estimate').text();
        if (!confirm('¿Sobrescribir permanentemente estos ' + selectedIds.length + ' elementos al idioma ' + targetLang + ' con la API?\nCosto estimado: ' + costText)) return;

        let btn = $(this);
        btn.prop('disabled', true).text('Traduciendo Lote...');

        let completed = 0;
        let errors = 0;

        function processNext() {
            if (completed + errors >= selectedIds.length) {
                btn.prop('disabled', false).text('Traducir ' + selectedIds.length + ' Posts (API)');
                alert('Lote completado. ' + errors + ' errores.');
                updateLangCounts();
                return;
            }

            let id = selectedIds[completed + errors];
            let post = findPost(id);

            $.post(utpData.ajaxurl, {
                action: 'utp_auto_translate',
                nonce: utpData.nonce,
                post_id: id,
                target_lang: targetLang
            }, function (response) {
                if (response.success) {
                    completed++;
                    if (post) {
                        post.detected_lang = targetLang;
                        post.title = response.data.title;
                        $('#lang-cell-' + post.id).html('<strong>' + targetLang + '</strong>');
                    }
                } else {
                    errors++;
                }

                btn.text('Traduciendo... (' + completed + '/' + selectedIds.length + ')');
                processNext();
            }).fail(function () {
                errors++;
                processNext();
            });
        }

        processNext();
    });

    // =========================================================
    // EXPORTAR / IMPORTAR
    // =========================================================
    $('#utp-export-btn').click(function () {
        let selectedIds = [];
        $('.utp-post-cb:checked').each(function () {
            selectedIds.push($(this).val());
        });
        if (selectedIds.length === 0) return;

        let btn = $(this);
        btn.prop('disabled', true).text('Generando...');

        $.post(utpData.ajaxurl, {
            action: 'utp_export_translations',
            nonce: utpData.nonce,
            post_ids: selectedIds
        }, function (response) {
            btn.prop('disabled', false).text('Exportar Seleccionados (.json)');
            if (response.success) {
                let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(response.data));
                let dlAnchorElem = document.createElement('a');
                dlAnchorElem.setAttribute("href", dataStr);
                dlAnchorElem.setAttribute("download", "utp_translations_export.json");
                dlAnchorElem.click();
            } else {
                alert('Error al exportar: ' + response.data);
            }
        }).fail(function () {
            btn.prop('disabled', false).text('Exportar Seleccionados (.json)');
            alert('Error de red.');
        });
    });

    $('#utp-import-btn').click(function () {
        $('#utp-import-file').click();
    });

    $('#utp-import-file').change(function (e) {
        let file = e.target.files[0];
        if (!file) return;

        let reader = new FileReader();
        reader.onload = function (evt) {
            try {
                let json = JSON.parse(evt.target.result);
                if (!Array.isArray(json)) {
                    alert("Formato de archivo inválido. Debe ser un Array JSON.");
                    return;
                }
                if (!confirm(`Se importarán ${json.length} elementos y se SOBRESCRIBIRÁN los textos locales que coincidan con sus slugs. ¿Deseas continuar?`)) return;

                let btn = $('#utp-import-btn');
                btn.prop('disabled', true).text('Importando...');

                $.post(utpData.ajaxurl, {
                    action: 'utp_import_translations',
                    nonce: utpData.nonce,
                    translations: JSON.stringify(json)
                }, function (response) {
                    btn.prop('disabled', false).text('Importar Traducciones (.json)');
                    if (response.success) {
                        alert(response.data);
                        $('#utp-filter-btn').click();
                    } else {
                        alert('Error al importar: ' + response.data);
                    }
                    $('#utp-import-file').val('');
                }).fail(function () {
                    btn.prop('disabled', false).text('Importar Traducciones (.json)');
                    alert('Error de red o archivo demasiado grande. Verifica en consola.');
                    $('#utp-import-file').val('');
                });
            } catch (ex) {
                alert("Error al leer o parsear el archivo JSON.");
                $('#utp-import-file').val('');
            }
        };
        reader.readAsText(file);
    });

    // =========================================================
    // URL MANAGER
    // =========================================================
    window.utpUrlsData = [];
    window.urlsLoaded = false;
    let urlCurrentPage = 0;
    let urlTotalPages = 1;

    function renderUrlRow(item) {
        return `<tr>
            <th scope="row" class="check-column"><input type="checkbox" name="url_ids[]" value="${item.id}" class="utp-url-cb"></th>
            <td><strong>${item.id}</strong> - ${item.title}</td>
            <td id="slug-cell-${item.id}"><code>${item.slug}</code></td>
            <td id="old-slugs-cell-${item.id}" style="color:#888;">${item.old_slugs || '-'}</td>
            <td><a href="${item.permalink}" target="_blank">Ver ↗</a></td>
        </tr>`;
    }

    function loadUrls(page) {
        let btn = $('#utp-load-more-urls-btn');
        btn.prop('disabled', true).text('Cargando...');

        $.post(utpData.ajaxurl, {
            action: 'utp_get_urls',
            nonce: utpData.nonce,
            paged: page
        }, function (response) {
            btn.prop('disabled', false).text('Cargar más URLs');
            if (!response.success) return;

            urlCurrentPage = response.data.paged;
            urlTotalPages = response.data.total_pages;
            window.utpUrlsData = window.utpUrlsData.concat(response.data.posts);

            let html = response.data.posts.map(renderUrlRow).join('');
            if (page > 1) {
                $('#utp-urls-list').append(html);
            } else {
                $('#utp-urls-list').html(html);
            }

            window.urlsLoaded = true;
            btn.toggle(urlCurrentPage < urlTotalPages);
        });
    }

    $('#utp-load-more-urls-btn').click(function () {
        loadUrls(urlCurrentPage + 1);
    });

    $(document).on('change', '.utp-url-cb, #cb-select-all-urls', function () {
        if ($(this).attr('id') === 'cb-select-all-urls') {
            $('.utp-url-cb').prop('checked', $(this).prop('checked'));
        }
        $('#utp-auto-translate-urls-btn').prop('disabled', $('.utp-url-cb:checked').length === 0);
    });

    $('#utp-auto-translate-urls-btn').click(function () {
        let selectedIds = [];
        $('.utp-url-cb:checked').each(function () {
            selectedIds.push($(this).val());
        });

        if (selectedIds.length === 0) return;

        let targetLang = $('#utp-target-lang-urls').val();
        if (!confirm(`¿Estás seguro de traducir ${selectedIds.length} enlaces al idioma ${targetLang}? Esto consumirá tokens de la API. Las URLs anteriores se guardarán para redirección 301.`)) return;

        let btn = $(this);
        btn.prop('disabled', true).text('Traduciendo Enlaces...');

        let completed = 0;
        let errors = 0;

        function processNextUrl() {
            if (completed + errors >= selectedIds.length) {
                btn.prop('disabled', false).text('Traducir URLs Seleccionadas');
                alert(`Lote completado. Éxitos: ${completed}, Errores: ${errors}.`);
                return;
            }

            let id = selectedIds[completed + errors];

            $.post(utpData.ajaxurl, {
                action: 'utp_translate_urls',
                nonce: utpData.nonce,
                post_id: id,
                target_lang: targetLang
            }, function (response) {
                if (response.success) {
                    completed++;
                    $('#slug-cell-' + id).html(`<code>${response.data.slug}</code>`);
                    if (response.data.old_slugs) {
                        $('#old-slugs-cell-' + id).html(response.data.old_slugs);
                    }
                } else {
                    errors++;
                    console.error('Error traduciendo URL ' + id, response.data);
                }
                btn.text(`Traduciendo... (${completed + errors}/${selectedIds.length})`);
                processNextUrl();
            }).fail(function () {
                errors++;
                processNextUrl();
            });
        }

        processNextUrl();
    });

    // =========================================================
    // RATES EDITOR
    // =========================================================
    $(document).on('click', '.utp-reset-rate-btn', function () {
        let key = $(this).data('key');
        let defaultVal = $(this).closest('tr').find('.utp-rate-input').data('default');
        $('#utp-rate-' + key).val(defaultVal);
    });

    $('#utp-save-rates-btn').click(function () {
        let btn = $(this);
        let result = $('#utp-rates-result');
        let rates = {};

        $('.utp-rate-input').each(function () {
            let key = $(this).data('key');
            let val = parseFloat($(this).val());
            if (key && !isNaN(val) && val > 0) {
                rates[key] = val;
            }
        });

        if (Object.keys(rates).length === 0) {
            result.css('color', '#d63638').text('❌ No hay tarifas válidas.');
            return;
        }

        btn.prop('disabled', true).text('Guardando...');
        result.css('color', '#555').text('');

        $.post(utpData.ajaxurl, {
            action: 'utp_save_rates',
            nonce: utpData.nonce,
            rates: rates
        }, function (response) {
            btn.prop('disabled', false).text('Actualizar Tarifas');
            if (response.success) {
                utpData.rates = Object.assign(utpData.rates || {}, rates);
                result.css('color', 'green').text('✅ ' + response.data);
            } else {
                result.css('color', '#d63638').text('❌ ' + response.data);
            }
        }).fail(function () {
            btn.prop('disabled', false).text('Actualizar Tarifas');
            result.css('color', '#d63638').text('❌ Error de red.');
        });
    });
});
