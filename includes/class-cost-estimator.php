<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class UTP_Cost_Estimator {

    // Tarifas por carácter (aprox.). Centralizadas para PHP y JS.
    private static $rates = array(
        'deepl'  => 0.000025,
        'openai' => 0.0000025,
        'google' => 0.000020,
        'gemini' => 0.00000035,
    );

    public static function get_rates() {
        return self::$rates;
    }

    public static function get_rate( $api_type ) {
        return isset( self::$rates[ $api_type ] ) ? self::$rates[ $api_type ] : 0;
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
