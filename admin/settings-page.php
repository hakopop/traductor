<?php if ( ! defined( 'ABSPATH' ) ) exit; ?>
<div class="wrap utp-wrap">
    <h1>Traductor Universal Pro</h1>

    <h2 class="nav-tab-wrapper utp-nav-tab-wrapper">
        <a href="#utp-tab-settings" class="nav-tab nav-tab-active">Configuración API</a>
        <a href="#utp-tab-database" class="nav-tab">Base de Datos (Posts/Páginas/Meta)</a>
        <a href="#utp-tab-urls" class="nav-tab">Enlaces SEO y Redirecciones</a>
        <a href="#utp-tab-strings" class="nav-tab">Cadenas (Temas/Plugins)</a>
    </h2>

    <!-- Tab 1: Settings -->
    <div id="utp-tab-settings" class="utp-tab-content active">
        <h2>Configuración de la API</h2>
        <form method="post" action="options.php">
            <?php settings_fields( 'utp_options_group' ); ?>
            <?php do_settings_sections( 'utp_options_group' ); ?>
            <table class="form-table">
                <tr valign="top">
                <th scope="row">Motor de Traducción</th>
                <td>
                    <select name="utp_api_type" id="utp_api_type">
                        <option value="deepl" <?php selected( get_option('utp_api_type', 'deepl'), 'deepl' ); ?>>DeepL API</option>
                        <option value="openai" <?php selected( get_option('utp_api_type'), 'openai' ); ?>>OpenAI (ChatGPT)</option>
                        <option value="google" <?php selected( get_option('utp_api_type'), 'google' ); ?>>Google Translate API</option>
                        <option value="gemini" <?php selected( get_option('utp_api_type'), 'gemini' ); ?>>Gemini API (Google AI Studio)</option>
                        <option value="openrouter" <?php selected( get_option('utp_api_type'), 'openrouter' ); ?>>OpenRouter (Modelos 100% Gratis y Libres)</option>
                    </select>
                </td>
                </tr>
                <tr valign="top">
                <th scope="row">API Key</th>
                <td><input type="password" name="utp_api_key" value="<?php echo esc_attr( get_option('utp_api_key') ); ?>" class="regular-text" autocomplete="off" /></td>
                </tr>
                <tr valign="top">
                <th scope="row">Modelo (Solo para OpenRouter)</th>
                <td>
                    <input type="text" name="utp_openrouter_model" value="<?php echo esc_attr( get_option('utp_openrouter_model', 'google/gemini-2.0-flash-lite-preview-02-05:free') ); ?>" class="regular-text" />
                    <p class="description">Ejemplos: <code>google/gemini-2.0-flash-lite-preview-02-05:free</code>, <code>qwen/qwen-2-7b-instruct:free</code>. <a href="https://openrouter.ai/models?max_price=0" target="_blank">Ver lista de gratuitos</a>.</p>
                </td>
                </tr>
                <tr valign="top">
                <th scope="row">Campos Meta Excluidos</th>
                <td>
                    <textarea name="utp_excluded_meta" class="large-text code" rows="5" placeholder="*brochure_title&#10;p_section_*&#10;tour_type"><?php echo esc_textarea( get_option('utp_excluded_meta', '') ); ?></textarea>
                    <p class="description">
                        Una key por línea. Admite comodín <code>*</code> (ej: <code>p_section_*</code> excluye todas las que empiecen así).<br>
                        El plugin ya excluye automáticamente keys de configuración (terminadas en <code>_type</code>, <code>_select</code>, <code>_layout</code>, etc.) y valores tipo slug (<code>standard</code>, <code>private-tour</code>). Usa esta lista para los casos que se escapen.
                    </p>
                </td>
                </tr>
            </table>
            <?php submit_button('Guardar Cambios', 'primary', 'submit', false); ?>
            <button type="button" id="utp-test-api-btn" class="button" style="margin-left: 10px;">Probar Conexión API</button>
            <span id="utp-test-api-result" style="margin-left: 10px; font-weight: bold;"></span>
        </form>
    </div>

    <!-- Tab 2: Database -->
    <div id="utp-tab-database" class="utp-tab-content" style="display:none;">
        <h2>Traducción de Base de Datos y Custom Fields</h2>

        <div class="utp-lang-summary-box" style="background:#fff; border:1px solid #ccc; padding:15px; margin-bottom:15px;">
            <h3>Resumen de Idiomas Actuales</h3>
            <div id="utp-lang-counts" style="font-size:16px; margin-bottom:10px;">
                Cargando conteo...
            </div>
            <button class="button" id="utp-scan-langs-btn">Escanear Idiomas Desconocidos (API)</button>
            <p class="description">Esto detectará el idioma de los posts que dicen "?" y guardará el resultado.</p>
        </div>

        <div class="utp-estimator-box">
            <h3>Traducción Masiva y Estimador de Costos</h3>
            <p style="margin-bottom: 10px;">
                <label for="utp-target-lang"><strong>Traducir al idioma:</strong></label>
                <select id="utp-target-lang">
                    <option value="EN">Inglés</option>
                    <option value="PT">Portugués</option>
                    <option value="ES">Español</option>
                    <option value="FR">Francés</option>
                </select>
            </p>
            <p style="color:#d63638;"><em>Nota: Los posts que ya estén en el idioma seleccionado serán omitidos automáticamente para ahorrar costos.</em></p>
            <p>Caracteres a traducir (incluye Título, Contenido y Meta): <span id="utp-char-count">0</span></p>
            <p>Costo estimado: <strong id="utp-cost-estimate">$0.00</strong></p>
            <button class="button button-primary" id="utp-auto-translate-btn" disabled>Traducir Seleccionados (API)</button>
        </div>

        <div class="tablenav top">
            <div class="alignleft actions">
                <select id="utp-post-type-filter">
                    <option value="">Todos los Tipos (Páginas, Tours, Menús, Formularios)</option>
                    <option value="page">Solo Páginas</option>
                    <option value="post">Solo Entradas (Posts)</option>
                    <option value="nav_menu_item">Solo Menús de Navegación</option>
                    <option value="wpcf7_contact_form">Solo Contact Form 7</option>
                </select>
                <button type="button" class="button" id="utp-filter-btn">Filtrar</button>
                <button type="button" class="button" id="utp-export-btn" disabled>Exportar Seleccionados (.json)</button>
                <button type="button" class="button" id="utp-import-btn" style="margin-left:5px;">Importar Traducciones (.json)</button>
                <input type="file" id="utp-import-file" accept=".json" style="display:none;" />
            </div>
            <div class="tablenav-pages">
                <span class="displaying-num" id="utp-total-items">0 elementos</span>
                <span class="pagination-links">
                    <button type="button" class="button" id="utp-prev-page" disabled>&lsaquo;</button>
                    <span class="paging-input"><span id="utp-current-page">1</span> de <span id="utp-total-pages">1</span></span>
                    <button type="button" class="button" id="utp-next-page" disabled>&rsaquo;</button>
                </span>
            </div>
        </div>

        <table class="wp-list-table widefat fixed striped" style="margin-top: 10px;">
            <thead>
                <tr>
                    <td id="cb" class="manage-column column-cb check-column"><input type="checkbox" id="cb-select-all"></td>
                    <th>ID</th>
                    <th>Tipo</th>
                    <th>Idioma Actual</th>
                    <th>Título Original</th>
                    <th>Acciones</th>
                    <th>Backup</th>
                </tr>
            </thead>
            <tbody id="utp-post-list">
                <tr><td colspan="7">Cargando posts...</td></tr>
            </tbody>
        </table>

        <p style="text-align:center; margin-top:15px;">
            <button class="button" id="utp-load-more-btn" style="display:none;">Cargar más posts</button>
            <span id="utp-pagination-info" class="description"></span>
        </p>
    </div>

    <!-- Tab 4: URLs SEO -->
    <div id="utp-tab-urls" class="utp-tab-content" style="display:none;">
        <h2>Gestor de Enlaces SEO y Redirecciones 301</h2>
        <p class="description">Traduce de forma segura las URLs de tus páginas. El sistema guardará el enlace anterior y redirigirá el tráfico automáticamente (Anti-404).</p>
        
        <div class="utp-estimator-box" style="margin-bottom: 15px;">
            <p style="margin-bottom: 10px;">
                <label for="utp-target-lang-urls"><strong>Generar Slugs en:</strong></label>
                <select id="utp-target-lang-urls">
                    <option value="EN">Inglés</option>
                    <option value="PT">Portugués</option>
                    <option value="ES">Español</option>
                    <option value="FR">Francés</option>
                </select>
            </p>
            <button class="button button-primary" id="utp-auto-translate-urls-btn" disabled>Traducir URLs Seleccionadas</button>
        </div>

        <table class="wp-list-table widefat fixed striped">
            <thead>
                <tr>
                    <td id="cb" class="manage-column column-cb check-column"><input type="checkbox" id="cb-select-all-urls"></td>
                    <th>ID / Título</th>
                    <th>URL Actual (Slug)</th>
                    <th>Historial de URLs Antiguas (Se redirigen 301)</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody id="utp-urls-list">
                <tr><td colspan="5">Cargando URLs...</td></tr>
            </tbody>
        </table>
        <p style="text-align:center; margin-top:15px;">
            <button class="button" id="utp-load-more-urls-btn" style="display:none;">Cargar más URLs</button>
        </p>
    </div>

    <!-- Tab 3: Strings -->
    <div id="utp-tab-strings" class="utp-tab-content" style="display:none;">
        <h2>Traducción de Cadenas</h2>
        <p>Próximamente: Escáner de archivos .po/.mo para temas y plugins.</p>
    </div>
</div>

<!-- Modal for Manual Editing -->
<div id="utp-manual-editor-modal" class="utp-modal" style="display:none;">
    <div class="utp-modal-content">
        <span class="utp-close-modal">&times;</span>
        <h2>Editor Manual Avanzado</h2>
        <p>A continuación se listan el Título, el Contenido principal y todos los <strong>Campos Personalizados (meta)</strong> encontrados.</p>

        <div id="utp-dynamic-fields-container">
            <!-- Populated by JS -->
        </div>

        <div class="utp-modal-actions" style="margin-top: 15px; text-align: right;">
            <input type="hidden" id="utp-edit-post-id" />
            <button class="button" id="utp-btn-auto-fill">Autotraducir todos estos campos (API)</button>
            <button class="button button-primary" id="utp-btn-save-manual">Guardar Permanentemente</button>
        </div>
    </div>
</div>
