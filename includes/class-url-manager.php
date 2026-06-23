<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class UTP_URL_Manager {
    
    public static function init() {
        add_action( 'template_redirect', array( __CLASS__, 'intercept_404_and_redirect' ), 1 );
        
        add_action( 'wp_ajax_utp_get_urls', array( __CLASS__, 'ajax_get_urls' ) );
        add_action( 'wp_ajax_utp_translate_urls', array( __CLASS__, 'ajax_translate_urls' ) );
    }

    public static function intercept_404_and_redirect() {
        if ( is_404() ) {
            global $wp;
            $requested_slug = basename( $wp->request );
            if ( empty( $requested_slug ) ) {
                return;
            }

            global $wpdb;
            $post_id = $wpdb->get_var( $wpdb->prepare( "
                SELECT post_id FROM {$wpdb->postmeta} 
                WHERE meta_key = '_utp_old_slugs' 
                AND meta_value LIKE %s
                LIMIT 1
            ", '%' . $wpdb->esc_like( '"' . $requested_slug . '"' ) . '%' ) );

            if ( ! $post_id ) {
                $post_id = $wpdb->get_var( $wpdb->prepare( "
                    SELECT post_id FROM {$wpdb->postmeta} 
                    WHERE meta_key = '_utp_old_slugs' 
                    AND meta_value LIKE %s
                    LIMIT 1
                ", '%' . $wpdb->esc_like( $requested_slug ) . '%' ) );
            }

            if ( $post_id ) {
                $new_url = get_permalink( $post_id );
                if ( $new_url ) {
                    wp_redirect( $new_url, 301 );
                    exit;
                }
            }
        }
    }

    public static function ajax_get_urls() {
        if ( ! current_user_can( 'manage_options' ) ) wp_send_json_error();

        $paged = isset( $_POST['paged'] ) ? intval( $_POST['paged'] ) : 1;
        $posts_per_page = 50;

        $args = array(
            'post_type'      => array( 'post', 'page', 'tour', 'product' ), // General post types and maybe custom 'tour'
            'post_status'    => 'publish',
            'posts_per_page' => $posts_per_page,
            'paged'          => $paged,
            'orderby'        => 'ID',
            'order'          => 'DESC',
        );

        $query = new WP_Query( $args );
        $data = array();

        foreach ( $query->posts as $p ) {
            $old_slugs = get_post_meta( $p->ID, '_utp_old_slugs', true );
            $old_slug_text = is_array( $old_slugs ) ? implode(', ', $old_slugs) : '';

            $data[] = array(
                'id'         => $p->ID,
                'title'      => $p->post_title,
                'slug'       => $p->post_name,
                'old_slugs'  => $old_slug_text,
                'permalink'  => get_permalink( $p->ID )
            );
        }

        wp_send_json_success( array(
            'posts'       => $data,
            'paged'       => $paged,
            'total_pages' => $query->max_num_pages,
            'total_posts' => $query->found_posts
        ) );
    }

    public static function ajax_translate_urls() {
        if ( ! current_user_can( 'manage_options' ) ) wp_send_json_error();

        $post_id = isset( $_POST['post_id'] ) ? intval( $_POST['post_id'] ) : 0;
        $target_lang = isset( $_POST['target_lang'] ) ? sanitize_text_field( $_POST['target_lang'] ) : 'ES';

        if ( ! $post_id ) wp_send_json_error( 'ID inválido' );

        $post = get_post( $post_id );
        if ( ! $post ) wp_send_json_error( 'Post no encontrado' );

        require_once UTP_PLUGIN_DIR . 'includes/class-api-client.php';
        
        $translated_title = UTP_API_Client::translate( $post->post_title, $target_lang );
        
        if ( is_wp_error( $translated_title ) ) {
            wp_send_json_error( $translated_title->get_error_message() );
        }

        $new_slug = sanitize_title( $translated_title );
        $old_slug = $post->post_name;

        if ( $new_slug === $old_slug ) {
            wp_send_json_success( array( 'slug' => $new_slug, 'msg' => 'El slug es el mismo.' ) );
        }

        $old_slugs = get_post_meta( $post_id, '_utp_old_slugs', true );
        if ( ! is_array( $old_slugs ) ) {
            $old_slugs = array();
        }
        if ( ! in_array( $old_slug, $old_slugs ) ) {
            $old_slugs[] = $old_slug;
            update_post_meta( $post_id, '_utp_old_slugs', $old_slugs );
        }

        wp_update_post( array(
            'ID' => $post_id,
            'post_name' => $new_slug
        ) );

        wp_send_json_success( array( 'slug' => $new_slug, 'old_slugs' => implode(', ', $old_slugs) ) );
    }
}
