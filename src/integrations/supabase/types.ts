export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          target_id: string | null
          target_type: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          provider_id: string
          request_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          provider_id: string
          request_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          provider_id?: string
          request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          company_name: string
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_name?: string
          id: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_name?: string
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          coupon_id: string
          id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          coupon_id: string
          id?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          coupon_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_assignments_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          discount_amount: number
          id: string
          redeemed_at: string
          request_id: string | null
          user_id: string
        }
        Insert: {
          coupon_id: string
          discount_amount?: number
          id?: string
          redeemed_at?: string
          request_id?: string | null
          user_id: string
        }
        Update: {
          coupon_id?: string
          discount_amount?: number
          id?: string
          redeemed_at?: string
          request_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_subsidy_ledger: {
        Row: {
          coupon_id: string
          created_at: string
          currency: string
          customer_id: string
          discount_amount: number
          id: string
          payable_at: string | null
          provider_id: string | null
          request_id: string
          status: string
          updated_at: string
        }
        Insert: {
          coupon_id: string
          created_at?: string
          currency?: string
          customer_id: string
          discount_amount: number
          id?: string
          payable_at?: string | null
          provider_id?: string | null
          request_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          coupon_id?: string
          created_at?: string
          currency?: string
          customer_id?: string
          discount_amount?: number
          id?: string
          payable_at?: string | null
          provider_id?: string | null
          request_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_subsidy_ledger_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_subsidy_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_subsidy_ledger_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_subsidy_ledger_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          created_at: string
          expires_at: string | null
          id: string
          max_uses: number
          min_amount: number
          type: string
          updated_at: string
          used_count: number
          value: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          max_uses?: number
          min_amount?: number
          type?: string
          updated_at?: string
          used_count?: number
          value?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          max_uses?: number
          min_amount?: number
          type?: string
          updated_at?: string
          used_count?: number
          value?: number
        }
        Relationships: []
      }
      driver_profiles: {
        Row: {
          available: boolean
          completed_rides: number
          created_at: string
          id: string
          rating_avg: number
          ratings_count: number
          status: string
          suspended_until: string | null
          updated_at: string
          user_id: string
          vehicle_category:
            | Database["public"]["Enums"]["vehicle_category"]
            | null
          vehicle_color: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
          vehicle_type: string | null
          vehicle_year: number | null
        }
        Insert: {
          available?: boolean
          completed_rides?: number
          created_at?: string
          id?: string
          rating_avg?: number
          ratings_count?: number
          status?: string
          suspended_until?: string | null
          updated_at?: string
          user_id: string
          vehicle_category?:
            | Database["public"]["Enums"]["vehicle_category"]
            | null
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_type?: string | null
          vehicle_year?: number | null
        }
        Update: {
          available?: boolean
          completed_rides?: number
          created_at?: string
          id?: string
          rating_avg?: number
          ratings_count?: number
          status?: string
          suspended_until?: string | null
          updated_at?: string
          user_id?: string
          vehicle_category?:
            | Database["public"]["Enums"]["vehicle_category"]
            | null
          vehicle_color?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_type?: string | null
          vehicle_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_wallets: {
        Row: {
          balance: number
          currency: string
          total_commission: number
          total_earned: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          currency?: string
          total_commission?: number
          total_earned?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          currency?: string
          total_commission?: number
          total_earned?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friend_requests: {
        Row: {
          created_at: string
          id: string
          receiver_id: string
          sender_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          receiver_id: string
          sender_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          receiver_id?: string
          sender_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_requests_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friend_requests_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friends: {
        Row: {
          created_at: string
          friend_id: string
          friend_phone: string | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          friend_id: string
          friend_phone?: string | null
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          friend_id?: string
          friend_phone?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friends_friend_id_fkey"
            columns: ["friend_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      live_locations: {
        Row: {
          heading: number | null
          lat: number
          lng: number
          request_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          heading?: number | null
          lat: number
          lng: number
          request_id: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          heading?: number | null
          lat?: number
          lng?: number
          request_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_locations_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_locations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json | null
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json | null
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          active: boolean
          base_fare: number
          commission_pct: number
          currency: string
          id: string
          minimum_fare: number
          per_km: number
          per_min: number
          updated_at: string
          vehicle_category: string
        }
        Insert: {
          active?: boolean
          base_fare?: number
          commission_pct?: number
          currency?: string
          id?: string
          minimum_fare?: number
          per_km?: number
          per_min?: number
          updated_at?: string
          vehicle_category: string
        }
        Update: {
          active?: boolean
          base_fare?: number
          commission_pct?: number
          currency?: string
          id?: string
          minimum_fare?: number
          per_km?: number
          per_min?: number
          updated_at?: string
          vehicle_category?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          phone: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_change_requests: {
        Row: {
          created_at: string
          id: string
          provider_type: string
          rejection_reason: string | null
          requested_data: Json
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider_type: string
          rejection_reason?: string | null
          requested_data: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider_type?: string
          rejection_reason?: string | null
          requested_data?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_change_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_change_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_presence: {
        Row: {
          heading: number | null
          lat: number
          lng: number
          updated_at: string
          user_id: string
        }
        Insert: {
          heading?: number | null
          lat: number
          lng: number
          updated_at?: string
          user_id: string
        }
        Update: {
          heading?: number | null
          lat?: number
          lng?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_verifications: {
        Row: {
          document_type: string
          email: string | null
          face_photo_path: string
          id_card_back_photo_path: string | null
          id_card_photo_path: string
          id_number: string | null
          legal_name: string
          metadata: Json
          phone: string | null
          provider_type: string
          rejection_reason: string | null
          reviewed_at: string | null
          status: string
          submitted_at: string
          updated_at: string
          user_id: string
          vehicle_document_path: string | null
        }
        Insert: {
          document_type?: string
          email?: string | null
          face_photo_path: string
          id_card_back_photo_path?: string | null
          id_card_photo_path: string
          id_number?: string | null
          legal_name: string
          metadata?: Json
          phone?: string | null
          provider_type: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id: string
          vehicle_document_path?: string | null
        }
        Update: {
          document_type?: string
          email?: string | null
          face_photo_path?: string
          id_card_back_photo_path?: string | null
          id_card_photo_path?: string
          id_number?: string | null
          legal_name?: string
          metadata?: Json
          phone?: string | null
          provider_type?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id?: string
          vehicle_document_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_delivery_outbox: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          expo_push_token: string
          expo_ticket_id: string | null
          http_request_id: number | null
          id: string
          last_error: string | null
          next_attempt_at: string
          offer_id: string
          payload: Json
          provider_id: string
          receipt_request_id: number | null
          receipt_requested_at: string | null
          request_id: string
          sent_at: string | null
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          expo_push_token: string
          expo_ticket_id?: string | null
          http_request_id?: number | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          offer_id: string
          payload: Json
          provider_id: string
          receipt_request_id?: number | null
          receipt_requested_at?: string | null
          request_id: string
          sent_at?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          expo_push_token?: string
          expo_ticket_id?: string | null
          http_request_id?: number | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          offer_id?: string
          payload?: Json
          provider_id?: string
          receipt_request_id?: number | null
          receipt_requested_at?: string | null
          request_id?: string
          sent_at?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_delivery_outbox_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "request_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_delivery_outbox_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          professionalism: number | null
          punctuality: number | null
          quality: number | null
          ratee_id: string
          rater_id: string
          request_id: string
          stars: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          professionalism?: number | null
          punctuality?: number | null
          quality?: number | null
          ratee_id: string
          rater_id: string
          request_id: string
          stars: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          professionalism?: number | null
          punctuality?: number | null
          quality?: number | null
          ratee_id?: string
          rater_id?: string
          request_id?: string
          stars?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_offers: {
        Row: {
          distance_km: number | null
          expires_at: string
          id: string
          offer_message: string | null
          proposed_price: number | null
          provider_id: string
          request_id: string
          responded_at: string | null
          sent_at: string
          status: string
        }
        Insert: {
          distance_km?: number | null
          expires_at?: string
          id?: string
          offer_message?: string | null
          proposed_price?: number | null
          provider_id: string
          request_id: string
          responded_at?: string | null
          sent_at?: string
          status?: string
        }
        Update: {
          distance_km?: number | null
          expires_at?: string
          id?: string
          offer_message?: string | null
          proposed_price?: number | null
          provider_id?: string
          request_id?: string
          responded_at?: string | null
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_offers_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_offers_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      service_dispatch_queue: {
        Row: {
          next_at: string
          request_id: string
          stage: number
        }
        Insert: {
          next_at?: string
          request_id: string
          stage?: number
        }
        Update: {
          next_at?: string
          request_id?: string
          stage?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_dispatch_queue_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requests: {
        Row: {
          accepted_at: string | null
          admin_notes: string | null
          cancellation_reason: string | null
          cancelled_by: string | null
          commission: number | null
          completed_at: string | null
          coupon_code: string | null
          coupon_discount: number
          coupon_id: string | null
          created_at: string
          customer_id: string
          customer_payable: number | null
          customer_price: number | null
          dest_lat: number | null
          dest_lng: number | null
          dest_text: string | null
          distance_km: number | null
          duration_min: number | null
          fare_breakdown: Json | null
          id: string
          is_intercity: boolean
          level_required: Database["public"]["Enums"]["worker_level"] | null
          notes: string | null
          payment_method: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_text: string
          price_estimate: number | null
          pricing_mode: string | null
          provider_id: string | null
          searching_started_at: string | null
          service_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["request_status"]
          type: Database["public"]["Enums"]["request_type"]
          updated_at: string
          vehicle_category:
            | Database["public"]["Enums"]["vehicle_category"]
            | null
          vehicle_type: string | null
          work_description: string | null
          work_hours: number | null
          workers_count: number
        }
        Insert: {
          accepted_at?: string | null
          admin_notes?: string | null
          cancellation_reason?: string | null
          cancelled_by?: string | null
          commission?: number | null
          completed_at?: string | null
          coupon_code?: string | null
          coupon_discount?: number
          coupon_id?: string | null
          created_at?: string
          customer_id: string
          customer_payable?: number | null
          customer_price?: number | null
          dest_lat?: number | null
          dest_lng?: number | null
          dest_text?: string | null
          distance_km?: number | null
          duration_min?: number | null
          fare_breakdown?: Json | null
          id?: string
          is_intercity?: boolean
          level_required?: Database["public"]["Enums"]["worker_level"] | null
          notes?: string | null
          payment_method?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_text?: string
          price_estimate?: number | null
          pricing_mode?: string | null
          provider_id?: string | null
          searching_started_at?: string | null
          service_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          type: Database["public"]["Enums"]["request_type"]
          updated_at?: string
          vehicle_category?:
            | Database["public"]["Enums"]["vehicle_category"]
            | null
          vehicle_type?: string | null
          work_description?: string | null
          work_hours?: number | null
          workers_count?: number
        }
        Update: {
          accepted_at?: string | null
          admin_notes?: string | null
          cancellation_reason?: string | null
          cancelled_by?: string | null
          commission?: number | null
          completed_at?: string | null
          coupon_code?: string | null
          coupon_discount?: number
          coupon_id?: string | null
          created_at?: string
          customer_id?: string
          customer_payable?: number | null
          customer_price?: number | null
          dest_lat?: number | null
          dest_lng?: number | null
          dest_text?: string | null
          distance_km?: number | null
          duration_min?: number | null
          fare_breakdown?: Json | null
          id?: string
          is_intercity?: boolean
          level_required?: Database["public"]["Enums"]["worker_level"] | null
          notes?: string | null
          payment_method?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_text?: string
          price_estimate?: number | null
          pricing_mode?: string | null
          provider_id?: string | null
          searching_started_at?: string | null
          service_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          type?: Database["public"]["Enums"]["request_type"]
          updated_at?: string
          vehicle_category?:
            | Database["public"]["Enums"]["vehicle_category"]
            | null
          vehicle_type?: string | null
          work_description?: string | null
          work_hours?: number | null
          workers_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_requests_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_requests_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          icon: string
          id: string
          name_ar: string
          name_en: string
          slug: string
          sort_order: number
        }
        Insert: {
          icon?: string
          id?: string
          name_ar: string
          name_en: string
          slug: string
          sort_order?: number
        }
        Update: {
          icon?: string
          id?: string
          name_ar?: string
          name_en?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      subscription_payments: {
        Row: {
          amount: number
          billing_cycle: string
          created_at: string
          currency: string
          failure_code: string | null
          gateway_payment_id: string | null
          gateway_status: string | null
          id: string
          merchant_request_id: string | null
          metadata: Json
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          plan_id: string | null
          provider: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          billing_cycle?: string
          created_at?: string
          currency?: string
          failure_code?: string | null
          gateway_payment_id?: string | null
          gateway_status?: string | null
          id?: string
          merchant_request_id?: string | null
          metadata?: Json
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          plan_id?: string | null
          provider?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          billing_cycle?: string
          created_at?: string
          currency?: string
          failure_code?: string | null
          gateway_payment_id?: string | null
          gateway_status?: string | null
          id?: string
          merchant_request_id?: string | null
          metadata?: Json
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          plan_id?: string | null
          provider?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          badge_color: string | null
          badge_label: string | null
          code: string
          created_at: string
          currency: string
          description_ar: string | null
          features: Json
          governorate_limit: number
          id: string
          is_active: boolean
          max_requests_per_month: number | null
          monthly_price: number
          name_ar: string
          name_en: string
          offer_priority: number
          priority_support: boolean
          priority_weight: number
          show_stats: boolean
          sort_order: number
          tier: number
          yearly_price: number
        }
        Insert: {
          badge_color?: string | null
          badge_label?: string | null
          code: string
          created_at?: string
          currency?: string
          description_ar?: string | null
          features?: Json
          governorate_limit?: number
          id?: string
          is_active?: boolean
          max_requests_per_month?: number | null
          monthly_price?: number
          name_ar: string
          name_en: string
          offer_priority?: number
          priority_support?: boolean
          priority_weight?: number
          show_stats?: boolean
          sort_order?: number
          tier?: number
          yearly_price?: number
        }
        Update: {
          badge_color?: string | null
          badge_label?: string | null
          code?: string
          created_at?: string
          currency?: string
          description_ar?: string | null
          features?: Json
          governorate_limit?: number
          id?: string
          is_active?: boolean
          max_requests_per_month?: number | null
          monthly_price?: number
          name_ar?: string
          name_en?: string
          offer_priority?: number
          priority_support?: boolean
          priority_weight?: number
          show_stats?: boolean
          sort_order?: number
          tier?: number
          yearly_price?: number
        }
        Relationships: []
      }
      subscription_settings: {
        Row: {
          id: number
          minimum_downloads_before_activation: number
          payment_gateway_enabled: boolean
          subscription_enabled: boolean
          updated_at: string
        }
        Insert: {
          id?: number
          minimum_downloads_before_activation?: number
          payment_gateway_enabled?: boolean
          subscription_enabled?: boolean
          updated_at?: string
        }
        Update: {
          id?: number
          minimum_downloads_before_activation?: number
          payment_gateway_enabled?: boolean
          subscription_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      support_conversations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_messages: {
        Row: {
          created_at: string
          id: string
          is_staff: boolean
          message: string
          sender_id: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_staff?: boolean
          message: string
          sender_id: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_staff?: boolean
          message?: string
          sender_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          priority: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          priority?: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          priority?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      taxi_dispatch_queue: {
        Row: {
          next_at: string
          request_id: string
          stage: number
        }
        Insert: {
          next_at?: string
          request_id: string
          stage?: number
        }
        Update: {
          next_at?: string
          request_id?: string
          stage?: number
        }
        Relationships: [
          {
            foreignKeyName: "taxi_dispatch_queue_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          balance_after: number | null
          created_at: string
          currency: string
          id: string
          note: string | null
          request_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          request_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          request_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_at: string
          blocked_by: string | null
          expires_at: string | null
          id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          blocked_at?: string
          blocked_by?: string | null
          expires_at?: string | null
          id?: string
          reason?: string | null
          user_id: string
        }
        Update: {
          blocked_at?: string
          blocked_by?: string | null
          expires_at?: string | null
          id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_by_fkey"
            columns: ["blocked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_push_tokens: {
        Row: {
          device_platform: string
          expo_push_token: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          device_platform?: string
          expo_push_token: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          device_platform?: string
          expo_push_token?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          reported_id: string | null
          reporter_id: string
          request_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          reported_id?: string | null
          reporter_id: string
          request_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          reported_id?: string | null
          reporter_id?: string
          request_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_reported_id_fkey"
            columns: ["reported_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "service_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          allowed_governorates: string[]
          auto_renew: boolean
          billing_cycle: string
          cancel_at_period_end: boolean
          cancelled_at: string | null
          card_brand: string | null
          card_last4: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string
          gateway_customer_ref: string | null
          grant_type: string
          granted_by: string | null
          id: string
          is_trial: boolean
          paused_at: string | null
          payment_token_ciphertext: string | null
          payment_token_iv: string | null
          payment_token_tag: string | null
          payment_token_type: string | null
          plan_id: string
          provider_types: string[]
          request_count: number
          resets_count_period_start: string
          status: string
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_governorates?: string[]
          auto_renew?: boolean
          billing_cycle?: string
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          card_brand?: string | null
          card_last4?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          gateway_customer_ref?: string | null
          grant_type?: string
          granted_by?: string | null
          id?: string
          is_trial?: boolean
          paused_at?: string | null
          payment_token_ciphertext?: string | null
          payment_token_iv?: string | null
          payment_token_tag?: string | null
          payment_token_type?: string | null
          plan_id: string
          provider_types?: string[]
          request_count?: number
          resets_count_period_start?: string
          status?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_governorates?: string[]
          auto_renew?: boolean
          billing_cycle?: string
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          card_brand?: string | null
          card_last4?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          gateway_customer_ref?: string | null
          grant_type?: string
          granted_by?: string | null
          id?: string
          is_trial?: boolean
          paused_at?: string | null
          payment_token_ciphertext?: string | null
          payment_token_iv?: string | null
          payment_token_tag?: string | null
          payment_token_type?: string | null
          plan_id?: string
          provider_types?: string[]
          request_count?: number
          resets_count_period_start?: string
          status?: string
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_models: {
        Row: {
          base_fare: number
          category: Database["public"]["Enums"]["vehicle_category"]
          created_at: string
          id: string
          make: string
          min_year: number
          model: string
          per_km: number
        }
        Insert: {
          base_fare?: number
          category: Database["public"]["Enums"]["vehicle_category"]
          created_at?: string
          id?: string
          make: string
          min_year?: number
          model: string
          per_km?: number
        }
        Update: {
          base_fare?: number
          category?: Database["public"]["Enums"]["vehicle_category"]
          created_at?: string
          id?: string
          make?: string
          min_year?: number
          model?: string
          per_km?: number
        }
        Relationships: []
      }
      worker_profiles: {
        Row: {
          available: boolean
          bio: string | null
          completed_jobs: number
          created_at: string
          id: string
          level: Database["public"]["Enums"]["worker_level"]
          rating_avg: number
          ratings_count: number
          status: string
          suspended_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          available?: boolean
          bio?: string | null
          completed_jobs?: number
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["worker_level"]
          rating_avg?: number
          ratings_count?: number
          status?: string
          suspended_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          available?: boolean
          bio?: string | null
          completed_jobs?: number
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["worker_level"]
          rating_avg?: number
          ratings_count?: number
          status?: string
          suspended_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_services: {
        Row: {
          service_id: string
          worker_id: string
        }
        Insert: {
          service_id: string
          worker_id: string
        }
        Update: {
          service_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_services_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      driver_public_stats: {
        Row: {
          available: boolean | null
          rating_avg: number | null
          ratings_count: number | null
          user_id: string | null
          vehicle_category:
            | Database["public"]["Enums"]["vehicle_category"]
            | null
        }
        Insert: {
          available?: boolean | null
          rating_avg?: number | null
          ratings_count?: number | null
          user_id?: string | null
          vehicle_category?:
            | Database["public"]["Enums"]["vehicle_category"]
            | null
        }
        Update: {
          available?: boolean | null
          rating_avg?: number | null
          ratings_count?: number | null
          user_id?: string | null
          vehicle_category?:
            | Database["public"]["Enums"]["vehicle_category"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_public_stats: {
        Row: {
          available: boolean | null
          level: Database["public"]["Enums"]["worker_level"] | null
          rating_avg: number | null
          ratings_count: number | null
          user_id: string | null
        }
        Insert: {
          available?: boolean | null
          level?: Database["public"]["Enums"]["worker_level"] | null
          rating_avg?: number | null
          ratings_count?: number | null
          user_id?: string | null
        }
        Update: {
          available?: boolean | null
          level?: Database["public"]["Enums"]["worker_level"] | null
          rating_avg?: number | null
          ratings_count?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_large_vehicle_offer: {
        Args: { _offer_id: string }
        Returns: boolean
      }
      accept_service_request: {
        Args: { _request_id: string }
        Returns: boolean
      }
      admin_adjust_wallet: {
        Args: {
          p_amount: number
          p_note: string
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_block_user: {
        Args: { p_expires_at: string; p_reason: string; p_user_id: string }
        Returns: undefined
      }
      admin_broadcast_notification: {
        Args: {
          p_body: string
          p_single_user_id: string
          p_target: string
          p_title: string
        }
        Returns: number
      }
      admin_cancel_free_subscription: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      admin_cancel_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      admin_coupon_audience_count: {
        Args: { p_target: string }
        Returns: number
      }
      admin_coupon_subsidy_report: {
        Args: never
        Returns: {
          payable_count: number
          payable_total: number
          pending_count: number
          pending_total: number
          void_count: number
        }[]
      }
      admin_delete_coupon: { Args: { p_coupon_id: string }; Returns: undefined }
      admin_delete_friend_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      admin_delete_friendship: {
        Args: { p_user1_id: string; p_user2_id: string }
        Returns: undefined
      }
      admin_delete_message: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      admin_distribute_coupon: {
        Args: {
          p_coupon_id: string
          p_single_user_id?: string
          p_target?: string
        }
        Returns: number
      }
      admin_extend_subscription: {
        Args: { p_days: number; p_user_id: string }
        Returns: string
      }
      admin_grant_role: {
        Args: { p_role: string; p_target_user: string }
        Returns: undefined
      }
      admin_grant_subscription: {
        Args: { p_duration: string; p_plan_code: string; p_user_id: string }
        Returns: string
      }
      admin_reopen_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      admin_resolve_report: {
        Args: { p_note: string; p_report_id: string; p_status: string }
        Returns: undefined
      }
      admin_review_provider_change_request: {
        Args: { _reason?: string; _request_id: string; _status: string }
        Returns: boolean
      }
      admin_revoke_role: {
        Args: { p_role: string; p_target_user: string }
        Returns: undefined
      }
      admin_save_coupon: {
        Args: {
          p_active: boolean
          p_code: string
          p_expires_at: string
          p_id: string
          p_max_uses: number
          p_min_amount: number
          p_type: string
          p_value: number
        }
        Returns: string
      }
      admin_set_provider_status: {
        Args: {
          p_status: string
          p_suspended_until?: string
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_set_subscription_status: {
        Args: { p_status: string; p_user_id: string }
        Returns: boolean
      }
      admin_unblock_user: { Args: { p_user_id: string }; Returns: undefined }
      advance_service_dispatch: {
        Args: { _request_id: string }
        Returns: number
      }
      advance_taxi_dispatch: { Args: { _request_id: string }; Returns: number }
      assert_staff: { Args: { p_level: string }; Returns: undefined }
      bootstrap_first_super_admin: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      cancel_own_subscription_at_period_end: { Args: never; Returns: boolean }
      cancel_service_request: {
        Args: { _reason: string; _request_id: string }
        Returns: string
      }
      check_request_allowed: {
        Args: { _user_id: string }
        Returns: {
          allowed: boolean
          plan_code: string
          reason: string
          requests_limit: number
          requests_used: number
        }[]
      }
      dispatch_service_request: {
        Args: { _request_id: string }
        Returns: number
      }
      expire_provider_suspensions: { Args: never; Returns: number }
      finalize_qicard_subscription_payment: {
        Args: {
          p_confirmed_amount: number
          p_currency: string
          p_gateway_payload?: Json
          p_gateway_payment_id: string
          p_gateway_status: string
          p_merchant_request_id: string
        }
        Returns: boolean
      }
      find_nearby_drivers: {
        Args: {
          _category: string
          _lat: number
          _limit?: number
          _lng: number
          _radius_km?: number
        }
        Returns: {
          distance_km: number
          rating_avg: number
          user_id: string
        }[]
      }
      find_nearby_provider_pins: {
        Args: {
          _category?: string
          _lat: number
          _limit?: number
          _lng: number
          _radius_km?: number
          _service_id?: string
          _type: string
        }
        Returns: {
          heading: number
          lat: number
          lng: number
          pin_id: string
        }[]
      }
      get_friend_status: { Args: { p_friend_id: string }; Returns: Json }
      get_my_coupons: {
        Args: never
        Returns: {
          active: boolean
          assigned_at: string
          code: string
          expires_at: string
          id: string
          min_amount: number
          type: string
          used: boolean
          value: number
        }[]
      }
      get_provider_reputation: { Args: { p_user_id: string }; Returns: Json }
      get_staff_roles: { Args: { p_user_id: string }; Returns: string[] }
      get_subscription_stats: {
        Args: never
        Returns: {
          active_subscriptions: number
          expired_subscriptions: number
          free_count: number
          gold_count: number
          monthly_revenue: number
          silver_count: number
          total_subscribers: number
          yearly_revenue: number
        }[]
      }
      get_subscription_stats_v2: {
        Args: never
        Returns: {
          active_subscriptions: number
          bronze_count: number
          expired_subscriptions: number
          free_count: number
          gold_count: number
          monthly_revenue: number
          silver_count: number
          total_subscribers: number
          trial_count: number
          yearly_revenue: number
        }[]
      }
      get_taxi_demand_multiplier: {
        Args: { _category?: string; _lat: number; _lng: number }
        Returns: number
      }
      get_user_subscription: {
        Args: { _user_id: string }
        Returns: {
          auto_renew: boolean
          badge_color: string
          badge_label: string
          current_period_end: string
          max_requests_per_month: number
          offer_priority: number
          plan_code: string
          plan_name_ar: string
          priority_support: boolean
          priority_weight: number
          request_count: number
          show_stats: boolean
          status: string
          subscription_enabled: boolean
          tier: number
        }[]
      }
      get_worker_service_catalog: {
        Args: never
        Returns: {
          id: string
          name_ar: string
          slug: string
        }[]
      }
      grant_provider_role_safe: {
        Args: { _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      handle_expired_subscriptions: { Args: never; Returns: number }
      has_admin_access: { Args: { p_user_id: string }; Returns: boolean }
      has_offer: {
        Args: { _request_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_staff_role: { Args: { p_user_id: string }; Returns: boolean }
      increment_request_count: {
        Args: { _user_id: string }
        Returns: undefined
      }
      is_request_customer: {
        Args: { _request_id: string; _user_id: string }
        Returns: boolean
      }
      is_request_party: {
        Args: { _request_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { p_user_id: string }; Returns: boolean }
      list_my_friends: {
        Args: never
        Returns: {
          full_name: string
          id: string
          phone: string
        }[]
      }
      list_pending_friend_requests: {
        Args: never
        Returns: {
          id: string
          sender_full_name: string
          sender_id: string
          sender_phone: string
        }[]
      }
      log_admin_action: {
        Args: {
          p_action: string
          p_details?: Json
          p_target_id: string
          p_target_type: string
        }
        Returns: undefined
      }
      lookup_email_by_phone: { Args: { _phone: string }; Returns: string }
      mamnoon_provider_kinds: { Args: { p_user_id: string }; Returns: string[] }
      mamnoon_provider_subscription_active: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      mamnoon_sql_test: { Args: never; Returns: boolean }
      mamnoon_test_offer: { Args: never; Returns: string }
      pause_own_subscription: { Args: never; Returns: boolean }
      preview_my_coupon: {
        Args: { p_amount: number; p_code: string }
        Returns: {
          code: string
          coupon_id: string
          discount: number
          payable: number
          type: string
          value: number
        }[]
      }
      process_mamnoon_push_outbox: { Args: never; Returns: number }
      process_service_dispatch: { Args: never; Returns: undefined }
      process_taxi_dispatch: { Args: never; Returns: undefined }
      reject_large_vehicle_offer: {
        Args: { _offer_id: string }
        Returns: boolean
      }
      reject_request_offer: { Args: { _offer_id: string }; Returns: boolean }
      respond_friend_request: {
        Args: { _accept: boolean; _request_id: string }
        Returns: boolean
      }
      restore_own_subscription_continuation: { Args: never; Returns: boolean }
      resume_own_subscription: { Args: never; Returns: boolean }
      retry_large_vehicle_dispatch: {
        Args: { _request_id: string }
        Returns: number
      }
      retry_taxi_dispatch: { Args: { _request_id: string }; Returns: number }
      save_initial_worker_services: {
        Args: { _service_ids: string[] }
        Returns: boolean
      }
      search_profile_by_phone: {
        Args: { _phone: string }
        Returns: {
          avatar_url: string
          full_name: string
          id: string
          phone: string
        }[]
      }
      search_profiles_for_friend: {
        Args: { _phone: string }
        Returns: {
          full_name: string
          id: string
          phone: string
        }[]
      }
      submit_large_vehicle_offer: {
        Args: { _message?: string; _price: number; _request_id: string }
        Returns: string
      }
      submit_provider_change_request: {
        Args: { _provider_type: string; _requested_data: Json }
        Returns: string
      }
      transition_service_request: {
        Args: {
          _reason?: string
          _request_id: string
          _status: Database["public"]["Enums"]["request_status"]
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "customer"
        | "driver"
        | "worker"
        | "admin"
        | "super_admin"
        | "support"
        | "finance"
        | "moderator"
        | "large_driver"
      request_status:
        | "pending"
        | "searching"
        | "accepted"
        | "in_progress"
        | "completed"
        | "cancelled"
      request_type: "taxi" | "service"
      vehicle_category: "economy" | "premium" | "luxury" | "large"
      worker_level: "fani" | "khabir"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "customer",
        "driver",
        "worker",
        "admin",
        "super_admin",
        "support",
        "finance",
        "moderator",
        "large_driver",
      ],
      request_status: [
        "pending",
        "searching",
        "accepted",
        "in_progress",
        "completed",
        "cancelled",
      ],
      request_type: ["taxi", "service"],
      vehicle_category: ["economy", "premium", "luxury", "large"],
      worker_level: ["fani", "khabir"],
    },
  },
} as const
