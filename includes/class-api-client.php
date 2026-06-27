<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class UTP_API_Client {

    // Modelos centralizados para poder actualizarlos en un solo lugar.
    const OPENAI_MODEL = 'gpt-4o-mini';
    const GEMINI_MODEL = 'gemini-2.5-flash';
    const HTTP_TIMEOUT = 45;

    public static function translate( $text, $target_lang = 'EN', $override_api_type = '', $override_api_key = '' ) {
        $result = self::translate_batch( array( $text ), $target_lang, $override_api_type, $override_api_key );
        if ( is_wp_error( $result ) ) return $result;
        return $result[0];
    }

    /**
     * Traduce VARIOS textos en la menor cantidad de peticiones posible.
     * - DeepL y Google aceptan múltiples textos en una sola petición (1 request por post).
     * - OpenAI y Gemini se traducen secuencialmente (no hay batch nativo confiable).
     *
     * @param string[] $texts Textos a traducir (índices preservados).
     * @return string[]|WP_Error Traducciones en el mismo orden, o error.
     */
    public static function translate_batch( $texts, $target_lang = 'EN', $override_api_type = '', $override_api_key = '' ) {
        // No enviar textos vacíos a la API: se devuelven tal cual.
        $to_translate = array();
        foreach ( $texts as $i => $t ) {
            if ( is_string( $t ) && trim( $t ) !== '' ) {
                $to_translate[ $i ] = $t;
            }
        }
        if ( empty( $to_translate ) ) return $texts;

        $api_type = !empty($override_api_type) ? $override_api_type : get_option( 'utp_api_type', 'deepl' );
        $api_key  = !empty($override_api_key) ? $override_api_key : get_option( 'utp_api_key' );

        if ( empty( $api_key ) ) {
            return new WP_Error( 'no_api_key', 'Falta la API Key en la configuración.' );
        }

        switch ( $api_type ) {
            case 'deepl':
                $translated = self::batch_deepl( array_values( $to_translate ), $target_lang, $api_key );
                break;
            case 'google':
                $translated = self::batch_google( array_values( $to_translate ), $target_lang, $api_key );
                break;
            case 'gemini':
                $translated = self::batch_sequential( array_values( $to_translate ), $target_lang, $api_key, 'gemini' );
                break;
            case 'openrouter':
                $translated = self::batch_sequential( array_values( $to_translate ), $target_lang, $api_key, 'openrouter' );
                break;
            default:
                $translated = self::batch_sequential( array_values( $to_translate ), $target_lang, $api_key, 'openai' );
        }

        if ( is_wp_error( $translated ) ) return $translated;

        // Reinsertar en las posiciones originales.
        $result = $texts;
        $j = 0;
        foreach ( $to_translate as $i => $_ ) {
            $result[ $i ] = $translated[ $j ];
            $j++;
        }
        return $result;
    }

    public static function detect_language( $text ) {
        if ( ! is_string( $text ) || trim( $text ) === '' ) return 'UNKNOWN';

        $api_type = get_option( 'utp_api_type', 'deepl' );
        $api_key  = get_option( 'utp_api_key' );

        if ( empty( $api_key ) ) return 'UNKNOWN';

        $sample = mb_substr( $text, 0, 300, 'UTF-8' );

        if ( 'deepl' === $api_type )  return self::detect_deepl( $sample, $api_key );
        if ( 'google' === $api_type ) return self::detect_google( $sample, $api_key );
        if ( 'gemini' === $api_type ) return self::detect_llm( $sample, $api_key, 'gemini' );
        return self::detect_llm( $sample, $api_key, 'openai' );
    }

    // --- DEEPL ---

    private static function deepl_url( $api_key ) {
        return ( strpos( $api_key, ':fx' ) === false )
            ? 'https://api.deepl.com/v2/translate'
            : 'https://api-free.deepl.com/v2/translate';
    }

    private static function batch_deepl( $texts, $target_lang, $api_key ) {
        $response = wp_remote_post( self::deepl_url( $api_key ), array(
            'timeout' => self::HTTP_TIMEOUT,
            'headers' => array(
                // Auth por header (el auth_key en el body está deprecado por DeepL)
                'Authorization' => 'DeepL-Auth-Key ' . $api_key,
                'Content-Type'  => 'application/json',
            ),
            'body' => wp_json_encode( array(
                'text'         => array_values( $texts ), // varios textos = 1 sola petición
                'target_lang'  => strtoupper( $target_lang ),
                'tag_handling' => 'html',
            ) ),
        ) );
        if ( is_wp_error( $response ) ) return $response;

        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( ! isset( $data['translations'] ) || count( $data['translations'] ) !== count( $texts ) ) {
            $msg = isset( $data['message'] ) ? $data['message'] : 'Error en DeepL API';
            return new WP_Error( 'api_error', $msg );
        }
        return array_map( function ( $t ) { return $t['text']; }, $data['translations'] );
    }

    private static function detect_deepl( $text, $api_key ) {
        $response = wp_remote_post( self::deepl_url( $api_key ), array(
            'timeout' => 20,
            'headers' => array(
                'Authorization' => 'DeepL-Auth-Key ' . $api_key,
                'Content-Type'  => 'application/json',
            ),
            'body' => wp_json_encode( array(
                'text'        => array( $text ),
                'target_lang' => 'EN', // Dummy: solo nos interesa detected_source_language
            ) ),
        ) );
        if ( is_wp_error( $response ) ) return 'UNKNOWN';
        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        return isset( $data['translations'][0]['detected_source_language'] )
            ? strtoupper( $data['translations'][0]['detected_source_language'] )
            : 'UNKNOWN';
    }

    // --- GOOGLE TRANSLATE ---

    private static function batch_google( $texts, $target_lang, $api_key ) {
        $response = wp_remote_post( 'https://translation.googleapis.com/language/translate/v2?key=' . rawurlencode( $api_key ), array(
            'timeout' => self::HTTP_TIMEOUT,
            'headers' => array( 'Content-Type' => 'application/json' ),
            'body'    => wp_json_encode( array(
                'q'      => array_values( $texts ), // 'q' acepta array = 1 sola petición
                'target' => strtolower( $target_lang ),
                'format' => 'html',
            ) ),
        ) );
        if ( is_wp_error( $response ) ) return $response;

        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( ! isset( $data['data']['translations'] ) || count( $data['data']['translations'] ) !== count( $texts ) ) {
            $msg = isset( $data['error']['message'] ) ? $data['error']['message'] : 'Error en Google API';
            return new WP_Error( 'api_error', $msg );
        }
        return array_map( function ( $t ) { return $t['translatedText']; }, $data['data']['translations'] );
    }

    private static function detect_google( $text, $api_key ) {
        $response = wp_remote_post( 'https://translation.googleapis.com/language/translate/v2/detect?key=' . rawurlencode( $api_key ), array(
            'timeout' => 20,
            'headers' => array( 'Content-Type' => 'application/json' ),
            'body'    => wp_json_encode( array( 'q' => $text ) ),
        ) );
        if ( is_wp_error( $response ) ) return 'UNKNOWN';

        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        return isset( $data['data']['detections'][0][0]['language'] )
            ? strtoupper( $data['data']['detections'][0][0]['language'] )
            : 'UNKNOWN';
    }

    // --- OPENAI / GEMINI (sin batch nativo: secuencial) ---

    private static function batch_sequential( $texts, $target_lang, $api_key, $provider ) {
        $out = array();
        foreach ( $texts as $text ) {
            switch ( $provider ) {
                case 'gemini':
                    $t = self::translate_gemini( $text, $target_lang, $api_key );
                    break;
                case 'openrouter':
                    $t = self::translate_openrouter( $text, $target_lang, $api_key );
                    break;
                case 'openai':
                default:
                    $t = self::translate_openai( $text, $target_lang, $api_key );
                    break;
            }
            if ( is_wp_error( $t ) ) return $t;
            $out[] = $t;
        }
        return $out;
    }

    private static function translation_prompt( $text, $target_lang ) {
        return "Translate the following text to $target_lang. Only return the translated text without any quotes or explanations. Maintain any HTML tags intact:\n\n" . $text;
    }

    private static function translate_openai( $text, $target_lang, $api_key ) {
        $response = wp_remote_post( 'https://api.openai.com/v1/chat/completions', array(
            'timeout' => self::HTTP_TIMEOUT,
            'headers' => array( 'Authorization' => 'Bearer ' . $api_key, 'Content-Type' => 'application/json' ),
            'body'    => wp_json_encode( array(
                'model'       => self::OPENAI_MODEL,
                'messages'    => array( array( 'role' => 'user', 'content' => self::translation_prompt( $text, $target_lang ) ) ),
                'temperature' => 0.3,
            ) ),
        ) );
        if ( is_wp_error( $response ) ) return $response;

        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( isset( $data['choices'][0]['message']['content'] ) ) {
            return trim( $data['choices'][0]['message']['content'] );
        }
        $msg = isset( $data['error']['message'] ) ? $data['error']['message'] : 'Error en OpenAI API';
        return new WP_Error( 'api_error', $msg );
    }

    private static function translate_openrouter( $text, $target_lang, $api_key ) {
        $url = 'https://openrouter.ai/api/v1/chat/completions';
        $model = get_option( 'utp_openrouter_model', 'google/gemini-2.0-flash-lite-preview-02-05:free' );
        
        $body = array(
            'model'       => $model,
            'messages'    => array(
                array(
                    'role'    => 'system',
                    'content' => "You are a professional translator. You output ONLY the exact translated text. NO conversational text. NO quotes. NO explanations. NO markdown formatting. Keep any shortcodes exactly as they are. Target language: $target_lang."
                ),
                array(
                    'role'    => 'user',
                    'content' => $text
                )
            ),
            'temperature' => 0.0,
        );

        $response = wp_remote_post( $url, array(
            'headers' => array(
                'Content-Type'  => 'application/json',
                'Authorization' => 'Bearer ' . $api_key,
                'HTTP-Referer'  => site_url(),
                'X-Title'       => 'Universal Translator Pro'
            ),
            'body'    => wp_json_encode( $body ),
            'timeout' => self::HTTP_TIMEOUT,
        ) );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code( $response );
        $body = wp_remote_retrieve_body( $response );
        $data = json_decode( $body, true );

        if ( $code !== 200 ) {
            $msg = isset( $data['error']['message'] ) ? $data['error']['message'] : 'OpenRouter API Error';
            return new WP_Error( 'api_error', $msg );
        }

        if ( ! isset( $data['choices'][0]['message']['content'] ) ) {
            return new WP_Error( 'api_error', 'Respuesta inesperada de OpenRouter.' );
        }

        return trim( $data['choices'][0]['message']['content'] );
    }

    private static function translate_gemini( $text, $target_lang, $api_key ) {
        $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . self::GEMINI_MODEL . ':generateContent?key=' . rawurlencode( $api_key );
        $response = wp_remote_post( $url, array(
            'timeout' => self::HTTP_TIMEOUT,
            'headers' => array( 'Content-Type' => 'application/json' ),
            'body'    => wp_json_encode( array(
                'contents'         => array( array( 'parts' => array( array( 'text' => self::translation_prompt( $text, $target_lang ) ) ) ) ),
                'generationConfig' => array( 'temperature' => 0.1 ),
            ) ),
        ) );
        if ( is_wp_error( $response ) ) return $response;

        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        if ( isset( $data['candidates'][0]['content']['parts'][0]['text'] ) ) {
            return trim( $data['candidates'][0]['content']['parts'][0]['text'] );
        }
        $msg = isset( $data['error']['message'] ) ? $data['error']['message'] : 'Error en Gemini API';
        return new WP_Error( 'api_error', $msg );
    }

    private static function detect_llm( $text, $api_key, $provider ) {
        $prompt = "Detect the language of the following text. Reply ONLY with the 2-letter ISO 639-1 code (e.g., EN, ES, PT, FR):\n\n" . $text;

        if ( 'gemini' === $provider ) {
            $url = 'https://generativelanguage.googleapis.com/v1beta/models/' . self::GEMINI_MODEL . ':generateContent?key=' . rawurlencode( $api_key );
            $response = wp_remote_post( $url, array(
                'timeout' => 20,
                'headers' => array( 'Content-Type' => 'application/json' ),
                'body'    => wp_json_encode( array(
                    'contents'         => array( array( 'parts' => array( array( 'text' => $prompt ) ) ) ) ,
                    'generationConfig' => array( 'temperature' => 0.0 ),
                ) ),
            ) );
            if ( is_wp_error( $response ) ) return 'UNKNOWN';
            $data = json_decode( wp_remote_retrieve_body( $response ), true );
            return isset( $data['candidates'][0]['content']['parts'][0]['text'] )
                ? strtoupper( trim( $data['candidates'][0]['content']['parts'][0]['text'] ) )
                : 'UNKNOWN';
        }

        $response = wp_remote_post( 'https://api.openai.com/v1/chat/completions', array(
            'timeout' => 20,
            'headers' => array( 'Authorization' => 'Bearer ' . $api_key, 'Content-Type' => 'application/json' ),
            'body'    => wp_json_encode( array(
                'model'       => self::OPENAI_MODEL,
                'messages'    => array( array( 'role' => 'user', 'content' => $prompt ) ),
                'temperature' => 0.1,
            ) ),
        ) );
        if ( is_wp_error( $response ) ) return 'UNKNOWN';
        $data = json_decode( wp_remote_retrieve_body( $response ), true );
        return isset( $data['choices'][0]['message']['content'] )
            ? strtoupper( trim( $data['choices'][0]['message']['content'] ) )
            : 'UNKNOWN';
    }
}
