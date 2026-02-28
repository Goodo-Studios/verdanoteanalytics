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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      account_context: {
        Row: {
          account_id: string
          audience_notes: string | null
          brand_brief: string | null
          competitor_notes: string | null
          creative_rules: Json | null
          offer_history: Json | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          account_id: string
          audience_notes?: string | null
          brand_brief?: string | null
          competitor_notes?: string | null
          creative_rules?: Json | null
          offer_history?: Json | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          audience_notes?: string | null
          brand_brief?: string | null
          competitor_notes?: string | null
          creative_rules?: Json | null
          offer_history?: Json | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_context_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_accounts: {
        Row: {
          company_description: string | null
          company_pdf_url: string | null
          created_at: string
          creative_analysis_prompt: string | null
          creative_count: number
          date_range_days: number
          id: string
          insights_prompt: string | null
          is_active: boolean
          iteration_spend_threshold: number
          kill_scale_kpi: string
          kill_scale_kpi_direction: string
          kill_threshold: number
          last_scheduled_report_at: string | null
          last_synced_at: string | null
          logo_url: string | null
          name: string
          portfolio_cta_url: string | null
          portfolio_enabled: boolean
          portfolio_headline: string | null
          portfolio_results: string[] | null
          portfolio_slug: string | null
          primary_kpi: string | null
          report_schedule: string
          scale_threshold: number
          secondary_kpis: string | null
          target_cpa: number | null
          target_monthly_spend: number | null
          target_roas: number | null
          untagged_count: number
          updated_at: string
          winner_kpi: string
          winner_kpi_direction: string
          winner_kpi_threshold: number
          winner_roas_threshold: number
        }
        Insert: {
          company_description?: string | null
          company_pdf_url?: string | null
          created_at?: string
          creative_analysis_prompt?: string | null
          creative_count?: number
          date_range_days?: number
          id: string
          insights_prompt?: string | null
          is_active?: boolean
          iteration_spend_threshold?: number
          kill_scale_kpi?: string
          kill_scale_kpi_direction?: string
          kill_threshold?: number
          last_scheduled_report_at?: string | null
          last_synced_at?: string | null
          logo_url?: string | null
          name: string
          portfolio_cta_url?: string | null
          portfolio_enabled?: boolean
          portfolio_headline?: string | null
          portfolio_results?: string[] | null
          portfolio_slug?: string | null
          primary_kpi?: string | null
          report_schedule?: string
          scale_threshold?: number
          secondary_kpis?: string | null
          target_cpa?: number | null
          target_monthly_spend?: number | null
          target_roas?: number | null
          untagged_count?: number
          updated_at?: string
          winner_kpi?: string
          winner_kpi_direction?: string
          winner_kpi_threshold?: number
          winner_roas_threshold?: number
        }
        Update: {
          company_description?: string | null
          company_pdf_url?: string | null
          created_at?: string
          creative_analysis_prompt?: string | null
          creative_count?: number
          date_range_days?: number
          id?: string
          insights_prompt?: string | null
          is_active?: boolean
          iteration_spend_threshold?: number
          kill_scale_kpi?: string
          kill_scale_kpi_direction?: string
          kill_threshold?: number
          last_scheduled_report_at?: string | null
          last_synced_at?: string | null
          logo_url?: string | null
          name?: string
          portfolio_cta_url?: string | null
          portfolio_enabled?: boolean
          portfolio_headline?: string | null
          portfolio_results?: string[] | null
          portfolio_slug?: string | null
          primary_kpi?: string | null
          report_schedule?: string
          scale_threshold?: number
          secondary_kpis?: string | null
          target_cpa?: number | null
          target_monthly_spend?: number | null
          target_roas?: number | null
          untagged_count?: number
          updated_at?: string
          winner_kpi?: string
          winner_kpi_direction?: string
          winner_kpi_threshold?: number
          winner_roas_threshold?: number
        }
        Relationships: []
      }
      ai_conversations: {
        Row: {
          account_id: string | null
          context: Json | null
          created_at: string | null
          id: string
          messages: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          context?: Json | null
          created_at?: string | null
          id?: string
          messages?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          context?: Json | null
          created_at?: string | null
          id?: string
          messages?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_insights: {
        Row: {
          account_id: string | null
          analysis: string
          created_at: string
          creative_count: number
          date_range_end: string | null
          date_range_start: string | null
          id: string
          title: string
          total_spend: number
          user_id: string
        }
        Insert: {
          account_id?: string | null
          analysis: string
          created_at?: string
          creative_count?: number
          date_range_end?: string | null
          date_range_start?: string | null
          id?: string
          title?: string
          total_spend?: number
          user_id: string
        }
        Update: {
          account_id?: string | null
          analysis?: string
          created_at?: string
          creative_count?: number
          date_range_end?: string | null
          date_range_start?: string | null
          id?: string
          title?: string
          total_spend?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_insights_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          permissions: string[] | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          permissions?: string[] | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          permissions?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      brief_templates: {
        Row: {
          account_id: string | null
          created_at: string | null
          created_by: string | null
          format: string | null
          id: string
          name: string
          sections: Json | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          format?: string | null
          id?: string
          name: string
          sections?: Json | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          format?: string | null
          id?: string
          name?: string
          sections?: Json | null
        }
        Relationships: []
      }
      briefs: {
        Row: {
          account_id: string
          assignee_name: string | null
          content: Json | null
          created_at: string | null
          created_by: string | null
          due_date: string | null
          id: string
          name: string
          reference_ad_ids: string[] | null
          share_token: string | null
          status: string
          template_id: string | null
        }
        Insert: {
          account_id: string
          assignee_name?: string | null
          content?: Json | null
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          id?: string
          name: string
          reference_ad_ids?: string[] | null
          share_token?: string | null
          status?: string
          template_id?: string | null
        }
        Update: {
          account_id?: string
          assignee_name?: string | null
          content?: Json | null
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          id?: string
          name?: string
          reference_ad_ids?: string[] | null
          share_token?: string | null
          status?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "briefs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "brief_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_ads: {
        Row: {
          ad_archive_id: string | null
          ad_creative_body: string | null
          competitor_id: string | null
          id: string
          is_active: boolean | null
          platforms: string[] | null
          saved_at: string | null
          started_running: string | null
          thumbnail_url: string | null
          video_url: string | null
        }
        Insert: {
          ad_archive_id?: string | null
          ad_creative_body?: string | null
          competitor_id?: string | null
          id?: string
          is_active?: boolean | null
          platforms?: string[] | null
          saved_at?: string | null
          started_running?: string | null
          thumbnail_url?: string | null
          video_url?: string | null
        }
        Update: {
          ad_archive_id?: string | null
          ad_creative_body?: string | null
          competitor_id?: string | null
          id?: string
          is_active?: boolean | null
          platforms?: string[] | null
          saved_at?: string | null
          started_running?: string | null
          thumbnail_url?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_ads_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          account_id: string
          brand_name: string
          created_at: string | null
          facebook_page_id: string | null
          facebook_page_name: string | null
          id: string
          notes: string | null
        }
        Insert: {
          account_id: string
          brand_name: string
          created_at?: string | null
          facebook_page_id?: string | null
          facebook_page_name?: string | null
          id?: string
          notes?: string | null
        }
        Update: {
          account_id?: string
          brand_name?: string
          created_at?: string | null
          facebook_page_id?: string | null
          facebook_page_name?: string | null
          id?: string
          notes?: string | null
        }
        Relationships: []
      }
      creative_daily_metrics: {
        Row: {
          account_id: string
          ad_id: string
          adds_to_cart: number | null
          clicks: number | null
          cost_per_add_to_cart: number | null
          cpa: number | null
          cpc: number | null
          cpm: number | null
          created_at: string
          ctr: number | null
          date: string
          frequency: number | null
          hold_rate: number | null
          impressions: number | null
          purchase_value: number | null
          purchases: number | null
          roas: number | null
          spend: number | null
          thumb_stop_rate: number | null
          video_avg_play_time: number | null
          video_views: number | null
        }
        Insert: {
          account_id: string
          ad_id: string
          adds_to_cart?: number | null
          clicks?: number | null
          cost_per_add_to_cart?: number | null
          cpa?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          date: string
          frequency?: number | null
          hold_rate?: number | null
          impressions?: number | null
          purchase_value?: number | null
          purchases?: number | null
          roas?: number | null
          spend?: number | null
          thumb_stop_rate?: number | null
          video_avg_play_time?: number | null
          video_views?: number | null
        }
        Update: {
          account_id?: string
          ad_id?: string
          adds_to_cart?: number | null
          clicks?: number | null
          cost_per_add_to_cart?: number | null
          cpa?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          date?: string
          frequency?: number | null
          hold_rate?: number | null
          impressions?: number | null
          purchase_value?: number | null
          purchases?: number | null
          roas?: number | null
          spend?: number | null
          thumb_stop_rate?: number | null
          video_avg_play_time?: number | null
          video_views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_daily_metrics_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "creatives"
            referencedColumns: ["ad_id"]
          },
        ]
      }
      creatives: {
        Row: {
          account_id: string
          ad_id: string
          ad_name: string
          ad_status: string | null
          ad_type: string | null
          adds_to_cart: number | null
          adset_name: string | null
          ai_analysis: string | null
          ai_cta_notes: string | null
          ai_hook_analysis: string | null
          ai_visual_notes: string | null
          analysis_status: string | null
          analyzed_at: string | null
          campaign_name: string | null
          clicks: number | null
          cost_per_add_to_cart: number | null
          cpa: number | null
          cpc: number | null
          cpm: number | null
          created_at: string
          creator_id: string | null
          ctr: number | null
          frequency: number | null
          hold_rate: number | null
          hook: string | null
          impressions: number | null
          notes: string | null
          person: string | null
          preview_url: string | null
          prior_roas: number | null
          product: string | null
          purchase_value: number | null
          purchases: number | null
          result_type: string | null
          roas: number | null
          scheduled_launch_date: string | null
          spend: number | null
          style: string | null
          tag_source: string
          theme: string | null
          thumb_stop_rate: number | null
          thumbnail_url: string | null
          unique_code: string | null
          updated_at: string
          video_avg_play_time: number | null
          video_url: string | null
          video_views: number | null
        }
        Insert: {
          account_id: string
          ad_id: string
          ad_name: string
          ad_status?: string | null
          ad_type?: string | null
          adds_to_cart?: number | null
          adset_name?: string | null
          ai_analysis?: string | null
          ai_cta_notes?: string | null
          ai_hook_analysis?: string | null
          ai_visual_notes?: string | null
          analysis_status?: string | null
          analyzed_at?: string | null
          campaign_name?: string | null
          clicks?: number | null
          cost_per_add_to_cart?: number | null
          cpa?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          creator_id?: string | null
          ctr?: number | null
          frequency?: number | null
          hold_rate?: number | null
          hook?: string | null
          impressions?: number | null
          notes?: string | null
          person?: string | null
          preview_url?: string | null
          prior_roas?: number | null
          product?: string | null
          purchase_value?: number | null
          purchases?: number | null
          result_type?: string | null
          roas?: number | null
          scheduled_launch_date?: string | null
          spend?: number | null
          style?: string | null
          tag_source?: string
          theme?: string | null
          thumb_stop_rate?: number | null
          thumbnail_url?: string | null
          unique_code?: string | null
          updated_at?: string
          video_avg_play_time?: number | null
          video_url?: string | null
          video_views?: number | null
        }
        Update: {
          account_id?: string
          ad_id?: string
          ad_name?: string
          ad_status?: string | null
          ad_type?: string | null
          adds_to_cart?: number | null
          adset_name?: string | null
          ai_analysis?: string | null
          ai_cta_notes?: string | null
          ai_hook_analysis?: string | null
          ai_visual_notes?: string | null
          analysis_status?: string | null
          analyzed_at?: string | null
          campaign_name?: string | null
          clicks?: number | null
          cost_per_add_to_cart?: number | null
          cpa?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          creator_id?: string | null
          ctr?: number | null
          frequency?: number | null
          hold_rate?: number | null
          hook?: string | null
          impressions?: number | null
          notes?: string | null
          person?: string | null
          preview_url?: string | null
          prior_roas?: number | null
          product?: string | null
          purchase_value?: number | null
          purchases?: number | null
          result_type?: string | null
          roas?: number | null
          scheduled_launch_date?: string | null
          spend?: number | null
          style?: string | null
          tag_source?: string
          theme?: string | null
          thumb_stop_rate?: number | null
          thumbnail_url?: string | null
          unique_code?: string | null
          updated_at?: string
          video_avg_play_time?: number | null
          video_url?: string | null
          video_views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "creatives_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creatives_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
      creators: {
        Row: {
          account_id: string
          contract_end: string | null
          contract_start: string | null
          created_at: string | null
          deal_type: string | null
          handle: string | null
          id: string
          name: string
          notes: string | null
          platform: string | null
          rate: string | null
          type: string | null
          wl_page_id: string | null
          wl_page_name: string | null
          wl_status: string | null
        }
        Insert: {
          account_id: string
          contract_end?: string | null
          contract_start?: string | null
          created_at?: string | null
          deal_type?: string | null
          handle?: string | null
          id?: string
          name: string
          notes?: string | null
          platform?: string | null
          rate?: string | null
          type?: string | null
          wl_page_id?: string | null
          wl_page_name?: string | null
          wl_status?: string | null
        }
        Update: {
          account_id?: string
          contract_end?: string | null
          contract_start?: string | null
          created_at?: string | null
          deal_type?: string | null
          handle?: string | null
          id?: string
          name?: string
          notes?: string | null
          platform?: string | null
          rate?: string | null
          type?: string | null
          wl_page_id?: string | null
          wl_page_name?: string | null
          wl_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creators_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      media_refresh_logs: {
        Row: {
          account_id: string
          api_errors: string | null
          completed_at: string | null
          current_phase: number
          duration_ms: number | null
          id: number
          started_at: string
          status: string
          thumbs_cached: number | null
          thumbs_failed: number | null
          thumbs_total: number | null
          videos_cached: number | null
          videos_failed: number | null
          videos_total: number | null
        }
        Insert: {
          account_id?: string
          api_errors?: string | null
          completed_at?: string | null
          current_phase?: number
          duration_ms?: number | null
          id?: never
          started_at?: string
          status?: string
          thumbs_cached?: number | null
          thumbs_failed?: number | null
          thumbs_total?: number | null
          videos_cached?: number | null
          videos_failed?: number | null
          videos_total?: number | null
        }
        Update: {
          account_id?: string
          api_errors?: string | null
          completed_at?: string | null
          current_phase?: number
          duration_ms?: number | null
          id?: never
          started_at?: string
          status?: string
          thumbs_cached?: number | null
          thumbs_failed?: number | null
          thumbs_total?: number | null
          videos_cached?: number | null
          videos_failed?: number | null
          videos_total?: number | null
        }
        Relationships: []
      }
      moodboard_items: {
        Row: {
          ad_id: string | null
          caption: string | null
          competitor_ad_id: string | null
          created_at: string | null
          id: string
          moodboard_id: string
          position: number | null
          thumbnail_url: string | null
          type: string
          url: string | null
        }
        Insert: {
          ad_id?: string | null
          caption?: string | null
          competitor_ad_id?: string | null
          created_at?: string | null
          id?: string
          moodboard_id: string
          position?: number | null
          thumbnail_url?: string | null
          type: string
          url?: string | null
        }
        Update: {
          ad_id?: string | null
          caption?: string | null
          competitor_ad_id?: string | null
          created_at?: string | null
          id?: string
          moodboard_id?: string
          position?: number | null
          thumbnail_url?: string | null
          type?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moodboard_items_moodboard_id_fkey"
            columns: ["moodboard_id"]
            isOneToOne: false
            referencedRelation: "moodboards"
            referencedColumns: ["id"]
          },
        ]
      }
      moodboards: {
        Row: {
          account_id: string | null
          created_at: string | null
          created_by: string
          description: string | null
          id: string
          is_shared: boolean | null
          name: string
          share_token: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          created_by: string
          description?: string | null
          id?: string
          is_shared?: boolean | null
          name: string
          share_token?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          id?: string
          is_shared?: boolean | null
          name?: string
          share_token?: string | null
        }
        Relationships: []
      }
      name_mappings: {
        Row: {
          account_id: string
          ad_type: string | null
          created_at: string
          hook: string | null
          id: string
          person: string | null
          product: string | null
          style: string | null
          theme: string | null
          unique_code: string
          updated_at: string
        }
        Insert: {
          account_id: string
          ad_type?: string | null
          created_at?: string
          hook?: string | null
          id?: string
          person?: string | null
          product?: string | null
          style?: string | null
          theme?: string | null
          unique_code: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          ad_type?: string | null
          created_at?: string
          hook?: string | null
          id?: string
          person?: string | null
          product?: string | null
          style?: string | null
          theme?: string | null
          unique_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "name_mappings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          account_id: string | null
          body: string | null
          created_at: string | null
          id: string
          read: boolean | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          body?: string | null
          created_at?: string | null
          id?: string
          read?: boolean | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          body?: string | null
          created_at?: string | null
          id?: string
          read?: boolean | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      performance_stories: {
        Row: {
          account_id: string
          content: string
          created_at: string
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_stories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      report_schedules: {
        Row: {
          account_id: string
          cadence: string
          created_at: string
          date_range_days: number
          deliver_to_app: boolean
          deliver_to_slack: boolean
          enabled: boolean
          id: string
          report_name_template: string
          updated_at: string
        }
        Insert: {
          account_id: string
          cadence: string
          created_at?: string
          date_range_days?: number
          deliver_to_app?: boolean
          deliver_to_slack?: boolean
          enabled?: boolean
          id?: string
          report_name_template?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          cadence?: string
          created_at?: string
          date_range_days?: number
          deliver_to_app?: boolean
          deliver_to_slack?: boolean
          enabled?: boolean
          id?: string
          report_name_template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          account_id: string | null
          average_cpa: number | null
          average_ctr: number | null
          blended_roas: number | null
          bottom_performers: string | null
          created_at: string
          creative_count: number | null
          date_range_days: number | null
          date_range_end: string | null
          date_range_start: string | null
          diag_all_weak: number
          diag_landing_page: number
          diag_total_diagnosed: number
          diag_weak_body: number
          diag_weak_cta: number
          diag_weak_cta_image: number
          diag_weak_hook: number
          diag_weak_hook_body: number
          id: string
          is_public: boolean
          iteration_suggestions: string | null
          portfolio_account_ids: string[] | null
          report_name: string
          report_type: string
          sections: Json | null
          tags_csv_count: number | null
          tags_manual_count: number | null
          tags_parsed_count: number | null
          tags_untagged_count: number | null
          top_performers: string | null
          total_spend: number | null
          win_rate: number | null
          win_rate_bof: number | null
          win_rate_mof: number | null
          win_rate_tof: number | null
        }
        Insert: {
          account_id?: string | null
          average_cpa?: number | null
          average_ctr?: number | null
          blended_roas?: number | null
          bottom_performers?: string | null
          created_at?: string
          creative_count?: number | null
          date_range_days?: number | null
          date_range_end?: string | null
          date_range_start?: string | null
          diag_all_weak?: number
          diag_landing_page?: number
          diag_total_diagnosed?: number
          diag_weak_body?: number
          diag_weak_cta?: number
          diag_weak_cta_image?: number
          diag_weak_hook?: number
          diag_weak_hook_body?: number
          id?: string
          is_public?: boolean
          iteration_suggestions?: string | null
          portfolio_account_ids?: string[] | null
          report_name: string
          report_type?: string
          sections?: Json | null
          tags_csv_count?: number | null
          tags_manual_count?: number | null
          tags_parsed_count?: number | null
          tags_untagged_count?: number | null
          top_performers?: string | null
          total_spend?: number | null
          win_rate?: number | null
          win_rate_bof?: number | null
          win_rate_mof?: number | null
          win_rate_tof?: number | null
        }
        Update: {
          account_id?: string | null
          average_cpa?: number | null
          average_ctr?: number | null
          blended_roas?: number | null
          bottom_performers?: string | null
          created_at?: string
          creative_count?: number | null
          date_range_days?: number | null
          date_range_end?: string | null
          date_range_start?: string | null
          diag_all_weak?: number
          diag_landing_page?: number
          diag_total_diagnosed?: number
          diag_weak_body?: number
          diag_weak_cta?: number
          diag_weak_cta_image?: number
          diag_weak_hook?: number
          diag_weak_hook_body?: number
          id?: string
          is_public?: boolean
          iteration_suggestions?: string | null
          portfolio_account_ids?: string[] | null
          report_name?: string
          report_type?: string
          sections?: Json | null
          tags_csv_count?: number | null
          tags_manual_count?: number | null
          tags_parsed_count?: number | null
          tags_untagged_count?: number | null
          top_performers?: string | null
          total_spend?: number | null
          win_rate?: number | null
          win_rate_bof?: number | null
          win_rate_mof?: number | null
          win_rate_tof?: number | null
        }
        Relationships: []
      }
      saved_views: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          is_shared: boolean | null
          name: string
          pinned: boolean | null
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_shared?: boolean | null
          name: string
          pinned?: boolean | null
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_shared?: boolean | null
          name?: string
          pinned?: boolean | null
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      split_test_variants: {
        Row: {
          ad_id: string
          id: string
          label: string
          test_id: string
        }
        Insert: {
          ad_id: string
          id?: string
          label: string
          test_id: string
        }
        Update: {
          ad_id?: string
          id?: string
          label?: string
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "split_test_variants_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "split_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      split_tests: {
        Row: {
          account_id: string
          created_at: string | null
          end_date: string | null
          hypothesis: string | null
          id: string
          minimum_spend: number | null
          name: string
          notes: string | null
          start_date: string | null
          status: string | null
          variable_tested: string | null
          winner_ad_id: string | null
        }
        Insert: {
          account_id: string
          created_at?: string | null
          end_date?: string | null
          hypothesis?: string | null
          id?: string
          minimum_spend?: number | null
          name: string
          notes?: string | null
          start_date?: string | null
          status?: string | null
          variable_tested?: string | null
          winner_ad_id?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string | null
          end_date?: string | null
          hypothesis?: string | null
          id?: string
          minimum_spend?: number | null
          name?: string
          notes?: string | null
          start_date?: string | null
          status?: string | null
          variable_tested?: string | null
          winner_ad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "split_tests_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          account_id: string
          api_errors: string | null
          completed_at: string | null
          creatives_fetched: number | null
          creatives_upserted: number | null
          current_phase: number
          date_range_end: string | null
          date_range_start: string | null
          duration_ms: number | null
          id: number
          meta_api_calls: number | null
          started_at: string
          status: string
          sync_state: Json
          sync_type: string
          tags_csv_matched: number | null
          tags_manual_preserved: number | null
          tags_parsed: number | null
          tags_untagged: number | null
        }
        Insert: {
          account_id: string
          api_errors?: string | null
          completed_at?: string | null
          creatives_fetched?: number | null
          creatives_upserted?: number | null
          current_phase?: number
          date_range_end?: string | null
          date_range_start?: string | null
          duration_ms?: number | null
          id?: never
          meta_api_calls?: number | null
          started_at?: string
          status?: string
          sync_state?: Json
          sync_type?: string
          tags_csv_matched?: number | null
          tags_manual_preserved?: number | null
          tags_parsed?: number | null
          tags_untagged?: number | null
        }
        Update: {
          account_id?: string
          api_errors?: string | null
          completed_at?: string | null
          creatives_fetched?: number | null
          creatives_upserted?: number | null
          current_phase?: number
          date_range_end?: string | null
          date_range_start?: string | null
          duration_ms?: number | null
          id?: never
          meta_api_calls?: number | null
          started_at?: string
          status?: string
          sync_state?: Json
          sync_type?: string
          tags_csv_matched?: number | null
          tags_manual_preserved?: number | null
          tags_parsed?: number | null
          tags_untagged?: number | null
        }
        Relationships: []
      }
      user_accounts: {
        Row: {
          account_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          dashboard_layout: Json | null
          digest_accounts: string[] | null
          digest_day: string | null
          digest_enabled: boolean | null
          first_login: boolean
          last_digest_sent_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          dashboard_layout?: Json | null
          digest_accounts?: string[] | null
          digest_day?: string | null
          digest_enabled?: boolean | null
          first_login?: boolean
          last_digest_sent_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          dashboard_layout?: Json | null
          digest_accounts?: string[] | null
          digest_day?: string | null
          digest_enabled?: boolean | null
          first_login?: boolean
          last_digest_sent_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whitelisting_deals: {
        Row: {
          access_expires_at: string | null
          access_granted_at: string | null
          account_id: string
          created_at: string | null
          creator_id: string | null
          creator_name: string
          id: string
          notes: string | null
          platform: string | null
          spend_to_date: number | null
          status: string | null
        }
        Insert: {
          access_expires_at?: string | null
          access_granted_at?: string | null
          account_id: string
          created_at?: string | null
          creator_id?: string | null
          creator_name: string
          id?: string
          notes?: string | null
          platform?: string | null
          spend_to_date?: number | null
          status?: string | null
        }
        Update: {
          access_expires_at?: string | null
          access_granted_at?: string | null
          account_id?: string
          created_at?: string | null
          creator_id?: string | null
          creator_name?: string
          id?: string
          notes?: string | null
          platform?: string | null
          spend_to_date?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whitelisting_deals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whitelisting_deals_creator_id_fkey"
            columns: ["creator_id"]
            isOneToOne: false
            referencedRelation: "creators"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bulk_update_creative_metadata: {
        Args: { payload: Json }
        Returns: number
      }
      bulk_update_creative_metrics: { Args: { payload: Json }; Returns: number }
      create_api_key: {
        Args: { api_key: string; key_name: string }
        Returns: string
      }
      get_user_account_ids: { Args: { _user_id: string }; Returns: string[] }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      snapshot_prior_roas: { Args: { _account_id: string }; Returns: number }
      trigger_media_refresh: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "builder" | "employee" | "client" | "editor"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["builder", "employee", "client", "editor"],
    },
  },
} as const
