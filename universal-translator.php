<?php
/**
 * Plugin Name: Universal Translator 
 * Description: Traductor masivo y permanente para WordPress con editor manual y estimador de costos de API.
 * Version: 1.1.0
 * Author: kiza
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}

define( 'UTP_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'UTP_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
define( 'UTP_VERSION', '1.1.0' );

// Includes (una sola vez aquí; ya no se repiten require_once dentro de los handlers AJAX)
require_once UTP_PLUGIN_DIR . 'includes/class-cost-estimator.php';
require_once UTP_PLUGIN_DIR . 'includes/class-api-client.php';
require_once UTP_PLUGIN_DIR . 'includes/class-db-translator.php';
require_once UTP_PLUGIN_DIR . 'includes/class-url-manager.php';

// Inicializar Módulo de URLs
UTP_URL_Manager::init();

// Admin Menu
add_action( 'admin_menu', 'utp_register_admin_menu' );

add_action( 'wp_ajax_utp_save_manual_translation', array( 'UTP_DB_Translator', 'ajax_save_manual_translation' ) );
add_action( 'wp_ajax_utp_restore_backup', array( 'UTP_DB_Translator', 'ajax_restore_backup' ) );
add_action( 'wp_ajax_utp_export_translations', array( 'UTP_DB_Translator', 'ajax_export_translations' ) );
add_action( 'wp_ajax_utp_import_translations', array( 'UTP_DB_Translator', 'ajax_import_translations' ) );
add_action( 'wp_ajax_utp_save_rates', 'utp_ajax_save_rates' );

function utp_ajax_save_rates() {
    check_ajax_referer( 'utp_ajax_nonce', 'nonce' );
    if ( ! current_user_can( 'manage_options' ) ) {
        wp_send_json_error( 'Permisos insuficientes.', 403 );
    }

    $allowed_keys = array( 'deepl', 'openai', 'google', 'gemini' );
    $new_rates = array();
    $raw = isset( $_POST['rates'] ) && is_array( $_POST['rates'] ) ? $_POST['rates'] : array();

    foreach ( $allowed_keys as $key ) {
        if ( isset( $raw[ $key ] ) ) {
            $val = floatval( $raw[ $key ] );
            if ( $val > 0 ) {
                $new_rates[ $key ] = $val;
            }
        }
    }

    if ( empty( $new_rates ) ) {
        wp_send_json_error( 'No se recibieron tarifas válidas.' );
    }

    update_option( 'utp_custom_rates', $new_rates );
    wp_send_json_success( 'Tarifas actualizadas correctamente.' );
}

function utp_register_admin_menu() {
    add_menu_page(
        'Universal Translator',
        'Traductor Universal',
        'manage_options',
        'universal-translator',
        'utp_render_admin_page',
        'dashicons-translation',
        100
    );
}

function utp_render_admin_page() {
    require_once UTP_PLUGIN_DIR . 'admin/settings-page.php';
}

// Register Settings (con sanitización)
add_action( 'admin_init', 'utp_register_settings' );
function utp_register_settings() {
    register_setting( 'utp_options_group', 'utp_api_type', array(
        'type'              => 'string',
        'sanitize_callback' => 'utp_sanitize_api_type',
        'default'           => 'deepl',
    ) );
    register_setting( 'utp_options_group', 'utp_api_key', array(
        'type'              => 'string',
        'sanitize_callback' => 'sanitize_text_field',
    ) );
    register_setting( 'utp_options_group', 'utp_excluded_meta', array(
        'type'              => 'string',
        'sanitize_callback' => 'sanitize_textarea_field',
        'default'           => '',
    ) );
}

function utp_sanitize_api_type( $value ) {
    $allowed = array( 'deepl', 'openai', 'google', 'gemini' );
    return in_array( $value, $allowed, true ) ? $value : 'deepl';
}

// Enqueue Scripts
add_action( 'admin_enqueue_scripts', 'utp_admin_scripts' );
function utp_admin_scripts( $hook ) {
    if ( 'toplevel_page_universal-translator' !== $hook ) {
        return;
    }

    wp_enqueue_style( 'utp-admin-css', UTP_PLUGIN_URL . 'assets/admin.css', array(), UTP_VERSION );
    wp_enqueue_script( 'utp-admin-js', UTP_PLUGIN_URL . 'assets/admin.js', array( 'jquery' ), UTP_VERSION, true );

    // Variables for JS. Se incluyen las tarifas para que el estimador de costos
    // sea instantáneo en el navegador (sin viajes AJAX extra).
    wp_localize_script( 'utp-admin-js', 'utpData', array(
        'ajaxurl'      => admin_url( 'admin-ajax.php' ),
        'nonce'        => wp_create_nonce( 'utp_ajax_nonce' ),
        'apiType'      => get_option( 'utp_api_type', 'deepl' ),
        'rates'        => UTP_Cost_Estimator::get_rates(),
        'defaultRates' => UTP_Cost_Estimator::get_default_rates(),
    ) );
}
