<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class UTP_DB_Translator {

    const POSTS_PER_PAGE = 50;

    public static function init() {
        add_action( 'wp_ajax_utp_get_posts', array( __CLASS__, 'ajax_get_posts' ) );
        add_action( 'wp_ajax_utp_get_post_detail', array( __CLASS__, 'ajax_get_post_detail' ) );
        add_action( 'wp_ajax_utp_save_manual_translation', array( __CLASS__, 'ajax_save_manual_translation' ) );
        add_action( 'wp_ajax_utp_auto_translate', array( __CLASS__, 'ajax_auto_translate' ) );
        add_action( 'wp_ajax_utp_detect_language', array( __CLASS__, 'ajax_detect_language' ) );
        add_action( 'wp_ajax_utp_test_api', array( __CLASS__, 'ajax_test_api' ) );
        add_action( 'wp_ajax_utp_restore_backup', array( __CLASS__, 'ajax_restore_backup' ) );
    }

    /**
     * Seguridad: nonce + capacidad. Antes solo se validaba el nonce,
     * lo que permitía a CUALQUIER usuario logueado (ej. suscriptor)
     * editar posts y gastar crédito de la API.
     */
    private static function verify_request() {
        check_ajax_referer( 'utp_ajax_nonce', 'nonce' );
        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( 'Permisos insuficientes.', 403 );
        }
    }

    public static function ajax_test_api() {
        self::verify_request();

        $api_type = isset($_POST['api_type']) ? sanitize_text_field($_POST['api_type']) : '';
        $api_key  = isset($_POST['api_key']) ? sanitize_text_field($_POST['api_key']) : '';

        $result = UTP_API_Client::translate( 'Hello world', 'ES', $api_type, $api_key );

        if ( is_wp_error( $result ) ) {
            wp_send_json_error( $result->get_error_message() );
        }

        wp_send_json_success( "Conexión exitosa. Traducción de prueba: 'Hello world' -> '" . $result . "'" );
    }

    /**
     * Sufijos de meta keys que son CONFIGURACIÓN del tema/builder, no contenido.
     * Traducirlos puede romper la página (el tema compara contra valores exactos).
     */
    private static $config_key_suffixes = array(
        '_type', '_select', '_layout', '_style', '_format', '_mode', '_template',
        '_color', '_icon', '_align', '_alignment', '_target', '_id', '_ids',
        '_size', '_position', '_class', '_status', '_option', '_variant',
        '_toggle', '_enabled', '_repeat', '_orientation', '_shape', '_theme',
        '_slug', '_key', '_field', '_source', '_order', '_orderby', '_display',
    );

    /**
     * Lista de exclusión configurable por el usuario (Configuración API).
     * Una key por línea; admite comodín * (ej: *brochure*, p_section_*_type).
     */
    private static function get_user_exclusions() {
        static $exclusions = null;
        if ( null === $exclusions ) {
            $raw = get_option( 'utp_excluded_meta', '' );
            $exclusions = array_filter( array_map( 'trim', explode( "\n", $raw ) ) );
        }
        return $exclusions;
    }

    private static function is_excluded_key( $key ) {
        // Sufijos de configuración (tour_type, pricebox_type, p_list_select...)
        foreach ( self::$config_key_suffixes as $suffix ) {
            if ( substr( $key, -strlen( $suffix ) ) === $suffix ) return true;
        }

        // Lista de exclusión del usuario (con comodines)
        foreach ( self::get_user_exclusions() as $pattern ) {
            if ( fnmatch( $pattern, $key, FNM_CASEFOLD ) ) return true;
        }

        return false;
    }

    private static function get_translatable_meta( $post_id ) {
        $meta_data = array();
        $all_meta = get_post_meta( $post_id );

        foreach ( $all_meta as $key => $values ) {
            // Ignorar meta keys internos
            if ( strpos( $key, '_' ) === 0 ) continue;

            // Ignorar keys de configuración y exclusiones del usuario
            if ( self::is_excluded_key( $key ) ) continue;

            $value = maybe_unserialize( $values[0] );

            // Solo procesar strings (ignorar arrays serializados por ahora por seguridad)
            if ( ! is_string( $value ) ) continue;

            $value = trim( $value );

            // Ignorar vacíos, números puros
            if ( $value === '' || is_numeric( $value ) ) continue;

            // Ignorar fechas, booleans o JSON básicos
            if ( in_array( strtolower( $value ), array( 'true', 'false', 'yes', 'no' ), true ) ) continue;

            // Ignorar si parece URL o ruta de archivo
            if ( preg_match( '/^(http:\/\/|https:\/\/|\/|[a-zA-Z]:\\\\|.*\.jpg$|.*\.png$)/i', $value ) ) continue;

            // Ignorar si es PURAMENTE un shortcode de WordPress (ej: [contact-form-7 id="1"])
            if ( preg_match( '/^\[[a-zA-Z0-9_\-]+.*\]$/', trim( $value ) ) ) continue;

            // Si es un JSON, lo dejamos pasar entero aquí. El desensamblador lo procesará en ajax_auto_translate.
            if ( ( strpos( trim($value), '{' ) === 0 || strpos( trim($value), '[' ) === 0 ) && json_decode( $value ) !== null ) {
                $meta_data[ $key ] = $value;
                continue;
            }

            // Ignorar cadenas muy cortas que probablemente sean IDs o configuraciones
            if ( mb_strlen( $value, 'UTF-8' ) <= 2 ) continue;

            // Ignorar valores tipo "slug" complejos (que contienen guiones o guiones bajos).
            // Si es una sola palabra simple (ej: "hard", "easy"), SÍ la traduciremos.
            if ( preg_match( '/^[a-z0-9]+[_\-]+[a-z0-9_\-]+$/', $value ) ) continue;

            $meta_data[ $key ] = $value;
        }

        return $meta_data;
    }

    /**
     * Lista LIGERA con paginación.
     * Antes se enviaba el contenido completo + meta de 50 posts en un JSON
     * (potencialmente varios MB). Ahora solo: id, título, tipo, idioma y
     * conteo de caracteres (para que el estimador de costos sea instantáneo
     * en el navegador, sin AJAX adicional).
     */
    private static function get_target_post_types() {
        $types = get_post_types( array( 'public' => true ), 'names' );
        // Añadir explícitamente tipos ocultos comunes
        $hidden_types = array( 'nav_menu_item', 'wpcf7_contact_form', 'wpforms', 'elementor_library', 'fluentform', 'forminator_forms' );
        foreach ( $hidden_types as $ht ) {
            if ( post_type_exists( $ht ) ) {
                $types[ $ht ] = $ht;
            }
        }
        return array_values( $types );
    }

    public static function ajax_get_posts() {
        self::verify_request();

        $paged = isset( $_POST['paged'] ) ? max( 1, intval( $_POST['paged'] ) ) : 1;
        $filter_type = isset( $_POST['filter_type'] ) ? sanitize_text_field( $_POST['filter_type'] ) : '';

        $post_types = $filter_type ? array( $filter_type ) : self::get_target_post_types();

        $query = new WP_Query( array(
            'post_type'              => $post_types,
            'post_status'            => array( 'publish', 'draft', 'private' ), // Los menús pueden no ser 'publish'
            'posts_per_page'         => self::POSTS_PER_PAGE,
            'paged'                  => $paged,
            'update_post_term_cache' => false,
        ) );

        $posts_data = array();
        foreach ( $query->posts as $p ) {
            $chars = mb_strlen( $p->post_title, 'UTF-8' ) + mb_strlen( $p->post_content, 'UTF-8' );
            foreach ( self::get_translatable_meta( $p->ID ) as $val ) {
                $chars += mb_strlen( $val, 'UTF-8' );
            }

            $posts_data[] = array(
                'id'            => $p->ID,
                'title'         => $p->post_title,
                'type'          => $p->post_type,
                'chars'         => $chars,
                'detected_lang' => get_post_meta( $p->ID, '_utp_detected_lang', true ) ?: '?',
                'has_backup'    => get_post_meta( $p->ID, '_utp_has_backup', true ) === 'yes',
            );
        }

        wp_send_json_success( array(
            'posts'       => $posts_data,
            'paged'       => $paged,
            'total_pages' => (int) $query->max_num_pages,
            'total_posts' => (int) $query->found_posts,
        ) );
    }

    /**
     * Detalle bajo demanda: el contenido y los meta solo viajan
     * cuando el usuario abre el editor manual de UN post.
     */
    public static function ajax_get_post_detail() {
        self::verify_request();

        $post_id = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
        $post = $post_id ? get_post( $post_id ) : null;
        if ( ! $post ) {
            wp_send_json_error( 'Post no encontrado' );
        }

        wp_send_json_success( array(
            'id'      => $post->ID,
            'title'   => $post->post_title,
            'content' => $post->post_content,
            'meta'    => self::get_translatable_meta( $post->ID ),
        ) );
    }

    private static function create_backup_if_not_exists( $post_id ) {
        if ( ! get_post_meta( $post_id, '_utp_has_backup', true ) ) {
            $post = get_post( $post_id );
            $meta = self::get_translatable_meta( $post_id );
            $backup_data = array(
                'title'   => $post->post_title,
                'content' => $post->post_content,
                'meta'    => $meta,
                'lang'    => get_post_meta( $post_id, '_utp_detected_lang', true ) ?: '?'
            );
            update_post_meta( $post_id, '_utp_backup_data', wp_json_encode( $backup_data ) );
            update_post_meta( $post_id, '_utp_has_backup', 'yes' );
        }
    }

    public static function ajax_restore_backup() {
        self::verify_request();

        $post_id = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
        if ( ! $post_id ) wp_send_json_error( 'ID inválido' );

        $backup_json = get_post_meta( $post_id, '_utp_backup_data', true );
        if ( empty( $backup_json ) ) wp_send_json_error( 'No hay backup para este elemento.' );

        $backup = json_decode( $backup_json, true );
        if ( ! is_array( $backup ) ) wp_send_json_error( 'Backup corrupto.' );

        wp_update_post( array(
            'ID'           => $post_id,
            'post_title'   => $backup['title'],
            'post_content' => $backup['content']
        ) );

        foreach ( $backup['meta'] as $key => $val ) {
            update_post_meta( $post_id, $key, wp_slash( $val ) );
        }

        delete_post_meta( $post_id, '_utp_detected_lang' );
        delete_post_meta( $post_id, '_utp_backup_data' );

        wp_send_json_success( 'Elemento restaurado a su estado original exitosamente.' );
    }

    public static function ajax_export_translations() {
        self::verify_request();
        $post_ids = isset( $_POST['post_ids'] ) && is_array( $_POST['post_ids'] ) ? array_map( 'intval', $_POST['post_ids'] ) : array();
        if ( empty( $post_ids ) ) {
            wp_send_json_error( 'No se seleccionaron elementos.' );
        }

        $export_data = array();
        foreach ( $post_ids as $id ) {
            $post = get_post( $id );
            if ( ! $post ) continue;

            $meta = self::get_translatable_meta( $id );

            $export_data[] = array(
                'id'            => $post->ID,
                'slug'          => $post->post_name,
                'type'          => $post->post_type,
                'title'         => $post->post_title,
                'content'       => $post->post_content,
                'detected_lang' => get_post_meta( $id, '_utp_detected_lang', true ),
                'meta'          => $meta
            );
        }

        wp_send_json_success( $export_data );
    }

    public static function ajax_import_translations() {
        self::verify_request();
        $translations_json = isset( $_POST['translations'] ) ? wp_unslash( $_POST['translations'] ) : ''; 
        $translations = json_decode( $translations_json, true );

        if ( ! is_array( $translations ) ) {
            wp_send_json_error( 'Formato JSON inválido o nulo.' );
        }

        $success_count = 0;
        foreach ( $translations as $item ) {
            if ( empty( $item['slug'] ) || empty( $item['type'] ) ) continue;

            // Match post by slug and type
            $posts = get_posts( array(
                'name'           => $item['slug'],
                'post_type'      => $item['type'],
                'post_status'    => 'any',
                'posts_per_page' => 1
            ) );

            if ( empty( $posts ) ) continue;
            $post_id = $posts[0]->ID;

            self::create_backup_if_not_exists( $post_id );

            wp_update_post( array(
                'ID'           => $post_id,
                'post_title'   => $item['title'],
                'post_content' => $item['content']
            ) );

            if ( ! empty( $item['meta'] ) && is_array( $item['meta'] ) ) {
                foreach ( $item['meta'] as $meta_key => $meta_val ) {
                    update_post_meta( $post_id, $meta_key, wp_slash( $meta_val ) );
                }
            }

            if ( ! empty( $item['detected_lang'] ) ) {
                update_post_meta( $post_id, '_utp_detected_lang', $item['detected_lang'] );
            }

            $success_count++;
        }

        wp_send_json_success( "Se importaron y sobrescribieron $success_count elementos exitosamente." );
    }

    public static function ajax_save_manual_translation() {
        self::verify_request();

        $post_id = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
        if ( ! $post_id ) {
            wp_send_json_error( 'ID inválido' );
        }

        self::create_backup_if_not_exists( $post_id );

        // Sanitización: antes el contenido y los meta se guardaban sin filtrar (riesgo de XSS).
        $title   = isset( $_POST['title'] ) ? sanitize_text_field( wp_unslash( $_POST['title'] ) ) : '';
        $content = isset( $_POST['content'] ) ? wp_kses_post( wp_unslash( $_POST['content'] ) ) : '';
        $meta    = isset( $_POST['meta'] ) && is_array( $_POST['meta'] ) ? wp_unslash( $_POST['meta'] ) : array();

        $result = wp_update_post( array(
            'ID'           => $post_id,
            'post_title'   => $title,
            'post_content' => $content,
        ), true );

        if ( is_wp_error( $result ) ) {
            wp_send_json_error( $result->get_error_message() );
        }

        foreach ( $meta as $key => $val ) {
            if ( ! is_string( $val ) ) continue;
            update_post_meta( $post_id, sanitize_text_field( $key ), wp_kses_post( $val ) );
        }

        wp_send_json_success( 'Guardado exitosamente.' );
    }

    private static $json_blacklist_keys = array(
        'type', 'name', 'id', '_id', 'class', 'style', 'tag', 'align', 'size', 'color', 
        'width', 'height', 'margin', 'padding', 'url', 'href', 'src', 'icon', 'layout',
        'position', 'status', 'action', 'method', 'target', 'format', 'version', 'css',
        '_element_id', '_css_classes', '_inline_css', 'widgetType', 'elType', 'isInner'
    );

    private static function extract_json_texts( $data, $path = '' ) {
        $texts = array();
        if ( is_array( $data ) || is_object( $data ) ) {
            foreach ( $data as $k => $v ) {
                $current_path = $path === '' ? (string)$k : $path . '|||' . $k;
                
                if ( is_string( $k ) && in_array( strtolower( $k ), self::$json_blacklist_keys, true ) ) {
                    continue;
                }

                if ( is_array( $v ) || is_object( $v ) ) {
                    $texts = array_merge( $texts, self::extract_json_texts( $v, $current_path ) );
                } else if ( is_string( $v ) ) {
                    $val = trim( $v );
                    if ( mb_strlen( $val, 'UTF-8' ) > 1 
                         && ! is_numeric( $val ) 
                         && ! preg_match( '/^\[[a-zA-Z0-9_\-]+.*\]$/', $val ) 
                         && ! preg_match( '/^(http:\/\/|https:\/\/|\/|[a-zA-Z]:\\\\|.*\.jpg$|.*\.png$)/i', $val ) ) {
                        
                        // Protección: no traducir palabras reservadas de constructores
                        if ( ! in_array( strtolower( $val ), array( 'image', 'video', 'text', 'section', 'column' ), true ) ) {
                            $texts[ $current_path ] = $val;
                        }
                    }
                }
            }
        }
        return $texts;
    }

    private static function inject_json_texts( &$data, $translations, $path = '' ) {
        if ( is_array( $data ) || is_object( $data ) ) {
            foreach ( $data as $k => &$v ) {
                $current_path = $path === '' ? (string)$k : $path . '|||' . $k;
                if ( is_array( $v ) || is_object( $v ) ) {
                    self::inject_json_texts( $v, $translations, $current_path );
                } else if ( is_string( $v ) ) {
                    if ( isset( $translations[ $current_path ] ) ) {
                        $v = $translations[ $current_path ];
                    }
                }
            }
        }
    }

    public static function ajax_auto_translate() {
        self::verify_request();

        $post_id     = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
        $target_lang = isset( $_POST['target_lang'] ) ? sanitize_text_field( $_POST['target_lang'] ) : 'EN';

        if ( ! $post_id ) {
            wp_send_json_error( 'ID inválido' );
        }

        $post = get_post( $post_id );
        if ( ! $post ) {
            wp_send_json_error( 'Post no encontrado' );
        }

        $meta  = self::get_translatable_meta( $post_id );
        $texts = array( '_title' => $post->post_title, '_content' => $post->post_content );
        $json_maps = array();

        foreach ( $meta as $key => $val ) {
            $val_trimmed = trim( $val );
            if ( ( strpos( $val_trimmed, '{' ) === 0 || strpos( $val_trimmed, '[' ) === 0 ) && ( $decoded = json_decode( $val_trimmed, true ) ) !== null ) {
                $extracted = self::extract_json_texts( $decoded );
                if ( ! empty( $extracted ) ) {
                    $json_maps[ $key ] = array( 'decoded' => $decoded, 'paths' => array() );
                    foreach ( $extracted as $path => $text ) {
                        $uid = 'json_' . md5( $key . $path );
                        $texts[ $uid ] = $text;
                        $json_maps[ $key ]['paths'][ $uid ] = $path;
                    }
                }
            } else {
                $texts[ $key ] = $val;
            }
        }

        self::create_backup_if_not_exists( $post_id );

        $translated = UTP_API_Client::translate_batch( $texts, $target_lang );
        if ( is_wp_error( $translated ) ) {
            wp_send_json_error( $translated->get_error_message() );
        }

        wp_update_post( array(
            'ID'           => $post_id,
            'post_title'   => $translated['_title'],
            'post_content' => $translated['_content'],
        ) );

        $trans_meta = array();
        foreach ( $meta as $key => $_orig ) {
            if ( isset( $json_maps[ $key ] ) ) {
                $map = $json_maps[ $key ];
                $decoded = $map['decoded'];
                $path_translations = array();
                foreach ( $map['paths'] as $uid => $path ) {
                    if ( isset( $translated[ $uid ] ) ) {
                        $path_translations[ $path ] = $translated[ $uid ];
                    }
                }
                self::inject_json_texts( $decoded, $path_translations );
                $final_val = wp_json_encode( $decoded, JSON_UNESCAPED_UNICODE );
                update_post_meta( $post_id, $key, wp_slash( $final_val ) );
                $trans_meta[ $key ] = $final_val;
            } else {
                if ( isset( $translated[ $key ] ) ) {
                    update_post_meta( $post_id, $key, wp_slash( $translated[ $key ] ) );
                    $trans_meta[ $key ] = $translated[ $key ];
                }
            }
        }

        // El post quedó en el idioma destino: actualizar la marca de idioma.
        update_post_meta( $post_id, '_utp_detected_lang', strtoupper( $target_lang ) );

        wp_send_json_success( array(
            'title'   => $translated['_title'],
            'content' => $translated['_content'],
            'meta'    => $trans_meta,
        ) );
    }

    public static function ajax_detect_language() {
        self::verify_request();

        $post_id = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
        if ( ! $post_id ) wp_send_json_error( 'ID inválido' );

        $post = get_post( $post_id );
        if ( ! $post ) wp_send_json_error( 'Post no encontrado' );

        $text_to_detect = $post->post_title . "\n" . wp_strip_all_tags( $post->post_content );
        $lang = UTP_API_Client::detect_language( $text_to_detect );

        if ( $lang !== 'UNKNOWN' ) {
            update_post_meta( $post_id, '_utp_detected_lang', $lang );
        }

        wp_send_json_success( $lang );
    }
}

UTP_DB_Translator::init();
