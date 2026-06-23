<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class UTP_Cost_Estimator {

    // Tarifas por defecto por carácter (aprox.).
    private static $default_rates = array(
        'deepl'  => 0.000025,
        'openai' => 0.0000025,
        'google' => 0.000020,
        'gemini' => 0.00000035,
    );

    /**
     * Devuelve las tarifas activas: primero intenta cargar las personalizadas
     * guardadas en la BD; si no existen, usa las de defecto.
     */
    public static function get_rates() {
        $saved = get_option( 'utp_custom_rates', array() );
        if ( ! is_array( $saved ) || empty( $saved ) ) {
            return self::$default_rates;
        }
        // Fusionar: las personalizadas sobreescriben las de defecto
        return array_merge( self::$default_rates, $saved );
    }

    public static function get_default_rates() {
        return self::$default_rates;
    }

    public static function get_rate( $api_type ) {
        $rates = self::get_rates();
        return isset( $rates[ $api_type ] ) ? $rates[ $api_type ] : 0;
    }

    /**
     * Estima a partir de un conteo de caracteres ya calculado.
     * Evita concatenar strings gigantes solo para medirlos.
     */
    public static function estimate_from_chars( $char_count, $api_type ) {
        return array(
            'chars' => (int) $char_count,
            'cost'  => round( $char_count * self::get_rate( $api_type ), 4 ),
        );
    }

    public static function estimate_cost( $text, $api_type ) {
        return self::estimate_from_chars( mb_strlen( $text, 'UTF-8' ), $api_type );
    }
}
