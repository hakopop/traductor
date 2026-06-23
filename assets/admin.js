jQuery(document).ready(function($) {
    // Estado local
    window.utpPostsData = [];
    let currentPage = 0;
    let totalPages = 1;
    let postsLoaded = false;

    function findPost(id) {
        return window.utpPostsData.find(p => p.id == id);
    }

    // Test API Connection
    $('#utp-test-api-btn').click(function(e) {
        e.preventDefault();
        let btn = $(this);
        let res = $('#utp-test-api-result');

        btn.prop('disabled', true).text('Probando...');
        res.css('color', '#555').text('Conectando con la API...');

        $.post(utpData.ajaxurl, {
            action: 'utp_test_api',
            nonce: utpData.nonce
        }, function(response) {
            btn.prop('disabled', false).text('Probar Conexión API');
            if (response.success) {
                res.css('color', 'green').text('✅ ' + response.data);
            } else {
                res.css('color', '#d63638').text('❌ Error: ' + response.data);
            }
        }).fail(function() {
            btn.prop('disabled', false).text('Probar Conexión API');
            res.css('color', '#d63638').text('❌ Error de red al intentar conectar.');
        });
    });

    // Tabs
    $('.utp-nav-tab-wrapper a').click(function(e){
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
            html += `<span style="display:inline-block; margin-right:15px; padding:5px 10px; background:#f0f0f1; border-radius:3px;">
                <strong>${label}:</strong> ${counts[lang]}
            </span>`;
        }
        $('#utp-lang-counts').html(html);
    }

    // Carga paginada: la lista ahora es ligera (sin contenido completo),
    // el contenido se pide solo al abrir el editor de un post.
    function loadPosts(page) {
        let btn = $('#utp-load-more-btn');
        btn.prop('disabled', true).text('Cargando...');
        
        let filterType = $('#utp-post-type-filter').val();

        $.post(utpData.ajaxurl, {
            action: 'utp_get_posts',
            nonce: utpData.nonce,
            paged: page,
            filter_type: filterType
        }, function(response) {
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

    $('#utp-load-more-btn').click(function() {
        loadPosts(currentPage + 1);
    });

    $('#utp-filter-btn').click(function() {
        window.utpPostsData = [];
        $('#utp-post-list').empty();
        loadPosts(1);
    });

    function rowHtml(post) {
        let safeTitle = $('<div>').text(post.title).html();
        let backupBtn = post.has_backup ? 
            `<button type="button" class="button utp-restore-btn" data-id="${post.id}" style="color:#d63638; border-color:#d63638;">Restaurar Original</button>` : 
            `<span style="color:#888; font-size:12px;">Sin backup</span>`;
            
        return `<tr>
            <th scope="row" class="check-column"><input type="checkbox" name="post_ids[]" value="${post.id}" class="utp-post-cb"></th>
            <td>${post.id}</td>
            <td><strong>${post.type}</strong></td>
            <td id="lang-cell-${post.id}"><strong>${post.detected_lang}</strong></td>
            <td><strong>${safeTitle}</strong></td>
            <td>
                <button type="button" class="button utp-edit-btn" data-id="${post.id}">Editor Manual</button>
                <button type="button" class="button utp-quick-trans-btn" data-id="${post.id}">Autotraducir</button>
            </td>
            <td>${backupBtn}</td>
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

    // Language Scan
    $('#utp-scan-langs-btn').click(function() {
        let toScan = window.utpPostsData.filter(p => p.detected_lang === '?');
        if (toScan.length === 0) {
            alert('Todos los posts ya tienen el idioma detectado.');
            return;
        }

        if (!confirm(`Se escanearán ${toScan.length} posts usando la API. ¿Deseas continuar?`)) return;

        let btn = $(this);
        btn.prop('disabled', true).text('Escaneando...');

        let completed = 0;
        function scanNext() {
            if (completed >= toScan.length) {
                btn.prop('disabled', false).text('Escanear Idiomas Desconocidos (API)');
                alert('Escaneo completado.');
                updateLangCounts();
                return;
            }

            let post = toScan[completed];
            $.post(utpData.ajaxurl, {
                action: 'utp_detect_language',
                nonce: utpData.nonce,
                post_id: post.id
            }, function(response) {
                if (response.success && response.data !== 'UNKNOWN') {
                    post.detected_lang = response.data;
                    $('#lang-cell-' + post.id).html('<strong>' + post.detected_lang + '</strong>');
                }
                completed++;
                btn.text('Escaneando... (' + completed + '/' + toScan.length + ')');
                scanNext();
            }).fail(function() {
                completed++;
                scanNext();
            });
        }
        scanNext();
    });

    // Estimador de costos INSTANTÁNEO (sin AJAX):
    // el servidor ya envió los caracteres por post y las tarifas por API.
    function updateEstimator() {
        let selectedIds = [];
        let skippedCount = 0;
        let totalChars = 0;
        let targetLang = $('#utp-target-lang').val();

        $('.utp-post-cb:checked').each(function() {
            let post = findPost($(this).val());
            if (!post) return;
            if (post.detected_lang === targetLang) {
                skippedCount++;
            } else {
                selectedIds.push(post.id);
                totalChars += post.chars || 0;
            }
        });

        window.utpValidIdsToTranslate = selectedIds;
        $('#utp-export-btn').prop('disabled', $('.utp-post-cb:checked').length === 0);

        if (selectedIds.length > 0) {
            let rate = (utpData.rates && utpData.rates[utpData.apiType]) || 0;
            let cost = (totalChars * rate).toFixed(4);
            let omitText = skippedCount > 0 ? ` <span style="color:#d63638">(${skippedCount} omitidos por estar ya en ${targetLang})</span>` : '';

            $('#utp-char-count').html(totalChars.toLocaleString() + omitText);
            $('#utp-cost-estimate').text('$' + cost + ' (' + utpData.apiType + ')');
            $('#utp-auto-translate-btn').prop('disabled', false).text('Traducir ' + selectedIds.length + ' Posts (API)');
        } else {
            $('#utp-char-count').html(skippedCount > 0 ? `<span style="color:#d63638">Todos los ${skippedCount} posts seleccionados ya están en ${targetLang}.</span>` : '0');
            $('#utp-cost-estimate').text('$0.00');
            $('#utp-auto-translate-btn').prop('disabled', true).text('Traducir Seleccionados (API)');
        }
    }

    $(document).on('change', '.utp-post-cb, #cb-select-all', function() {
        if ($(this).attr('id') === 'cb-select-all') {
            $('.utp-post-cb').prop('checked', $(this).prop('checked'));
        }
        updateEstimator();
    });

    $('#utp-target-lang').change(function() {
        if ($('.utp-post-cb:checked').length > 0) {
            updateEstimator();
        }
    });

    // Modal Builder Helper
    function buildRow(label, key, originalVal, isTextarea) {
        let escapedVal = $('<div>').text(originalVal).html();
        let inputHtml = isTextarea ?
            `<textarea class="widefat utp-meta-input" data-key="${key}" rows="4">${escapedVal}</textarea>` :
            `<input type="text" class="widefat utp-meta-input" data-key="${key}" value="${escapedVal}" />`;

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

    // Manual Editor Modal: el detalle (contenido + meta) se carga bajo demanda.
    $(document).on('click', '.utp-edit-btn', function() {
        let id = $(this).data('id');
        let btn = $(this);

        btn.prop('disabled', true).text('Cargando...');

        $.post(utpData.ajaxurl, {
            action: 'utp_get_post_detail',
            nonce: utpData.nonce,
            post_id: id
        }, function(response) {
            btn.prop('disabled', false).text('Editor Manual');
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
        }).fail(function() {
            btn.prop('disabled', false).text('Editor Manual');
            alert('Error de red al cargar el post.');
        });
    });

    $('.utp-close-modal').click(function() {
        $('#utp-manual-editor-modal').hide();
    });

    // Save Manual Translation
    $('#utp-btn-save-manual').click(function() {
        let btn = $(this);
        btn.prop('disabled', true).text('Guardando...');

        let post_id = $('#utp-edit-post-id').val();
        let title = '';
        let content = '';
        let meta = {};

        $('.utp-meta-input').each(function() {
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
        }, function(response) {
            btn.prop('disabled', false).text('Guardar Permanentemente');
            if (response.success) {
                // Reflejar el nuevo título en la tabla sin recargar
                let post = findPost(post_id);
                if (post) post.title = title;
                $('#utp-manual-editor-modal').hide();
                alert('Guardado exitoso.');
            } else {
                alert('Error: ' + response.data);
            }
        });
    });

    // Auto Translate Individual
    $(document).on('click', '.utp-quick-trans-btn, #utp-btn-auto-fill', function() {
        let btn = $(this);
        let isModal = btn.attr('id') === 'utp-btn-auto-fill';
        let id = isModal ? $('#utp-edit-post-id').val() : btn.data('id');
        let targetLang = $('#utp-target-lang').val();

        let post = findPost(id);
        if (!isModal && post && post.detected_lang === targetLang) {
            if(!confirm(`Este post ya está marcado como ${targetLang}. ¿Estás seguro de querer traducirlo de nuevo y gastar tokens?`)) {
                return;
            }
        }

        btn.prop('disabled', true).text('Traduciendo...');

        $.post(utpData.ajaxurl, {
            action: 'utp_auto_translate',
            nonce: utpData.nonce,
            post_id: id,
            target_lang: targetLang
        }, function(response) {
            btn.prop('disabled', false).text(isModal ? 'Autotraducir todos estos campos (API)' : 'Autotraducir');
            if (response.success) {
                if (isModal) {
                    $('.utp-meta-input[data-key="_utp_title"]').val(response.data.title);
                    $('.utp-meta-input[data-key="_utp_content"]').val(response.data.content);
                    for (let metaKey in response.data.meta) {
                        $('.utp-meta-input[data-key="'+metaKey+'"]').val(response.data.meta[metaKey]);
                    }
                } else {
                    if (post) {
                        post.detected_lang = targetLang;
                        post.title = response.data.title;
                        $('#lang-cell-' + post.id).html('<strong>' + targetLang + '</strong>');
                        updateLangCounts();
                    }
                    alert('Traducido permanentemente!');
                }
            } else {
                alert('Error de API: ' + (response.data || 'Revisa tu API Key'));
            }
        }).fail(function() {
            btn.prop('disabled', false).text(isModal ? 'Autotraducir todos estos campos (API)' : 'Autotraducir');
            alert('Error de red o timeout del servidor.');
        });
    });

    // Restore Backup
    $(document).on('click', '.utp-restore-btn', function() {
        let btn = $(this);
        let id = btn.data('id');
        
        if(!confirm('¿Estás seguro de que deseas deshacer la traducción y restaurar el texto original de este elemento? Esto sobrescribirá la versión actual.')) return;

        btn.prop('disabled', true).text('Restaurando...');

        $.post(utpData.ajaxurl, {
            action: 'utp_restore_backup',
            nonce: utpData.nonce,
            post_id: id
        }, function(response) {
            btn.prop('disabled', false).text('Restaurar Original');
            if (response.success) {
                alert(response.data);
                // Reload row data
                window.utpPostsData = [];
                $('#utp-post-list').empty();
                loadPosts(currentPage);
            } else {
                alert('Error al restaurar: ' + response.data);
            }
        }).fail(function() {
            btn.prop('disabled', false).text('Restaurar Original');
            alert('Error de red.');
        });
    });

    // Batch Auto Translate
    $('#utp-auto-translate-btn').click(function() {
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
            }, function(response) {
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
            }).fail(function() {
                errors++;
                processNext();
            });
        }

        processNext();
    });

    // Export Translations
    $('#utp-export-btn').click(function() {
        let selectedIds = [];
        $('.utp-post-cb:checked').each(function() {
            selectedIds.push($(this).val());
        });
        if (selectedIds.length === 0) return;
        
        let btn = $(this);
        btn.prop('disabled', true).text('Generando...');
        
        $.post(utpData.ajaxurl, {
            action: 'utp_export_translations',
            nonce: utpData.nonce,
            post_ids: selectedIds
        }, function(response) {
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
        }).fail(function() {
            btn.prop('disabled', false).text('Exportar Seleccionados (.json)');
            alert('Error de red.');
        });
    });

    // Import Translations
    $('#utp-import-btn').click(function() {
        $('#utp-import-file').click();
    });

    $('#utp-import-file').change(function(e) {
        let file = e.target.files[0];
        if (!file) return;

        let reader = new FileReader();
        reader.onload = function(evt) {
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
                }, function(response) {
                    btn.prop('disabled', false).text('Importar Traducciones (.json)');
                    if (response.success) {
                        alert(response.data);
                        $('#utp-filter-btn').click();
                    } else {
                        alert('Error al importar: ' + response.data);
                    }
                    $('#utp-import-file').val('');
                }).fail(function() {
                    btn.prop('disabled', false).text('Importar Traducciones (.json)');
                    alert('Error de red o archivo demasiado grande. Verifica en consola.');
                    $('#utp-import-file').val('');
                });
            } catch(ex) {
                alert("Error al leer o parsear el archivo JSON.");
                $('#utp-import-file').val('');
            }
        };
        reader.readAsText(file);
    });

    // --- URL MANAGER LOGIC ---
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
        }, function(response) {
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

    $('#utp-load-more-urls-btn').click(function() {
        loadUrls(urlCurrentPage + 1);
    });

    $(document).on('change', '.utp-url-cb, #cb-select-all-urls', function() {
        if ($(this).attr('id') === 'cb-select-all-urls') {
            $('.utp-url-cb').prop('checked', $(this).prop('checked'));
        }
        $('#utp-auto-translate-urls-btn').prop('disabled', $('.utp-url-cb:checked').length === 0);
    });

    $('#utp-auto-translate-urls-btn').click(function() {
        let selectedIds = [];
        $('.utp-url-cb:checked').each(function() {
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
            }, function(response) {
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
            }).fail(function() {
                errors++;
                processNextUrl();
            });
        }

        processNextUrl();
    });
});
