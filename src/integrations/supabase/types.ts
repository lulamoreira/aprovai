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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      acessos_cliente: {
        Row: {
          cliente_contato_id: string
          criado_em: string
          decidido_em: string | null
          decisao: string | null
          expira_em: string
          handoff_id: string | null
          id: string
          peca_id: string
          token: string
          ultimo_acesso: string | null
        }
        Insert: {
          cliente_contato_id: string
          criado_em?: string
          decidido_em?: string | null
          decisao?: string | null
          expira_em?: string
          handoff_id?: string | null
          id?: string
          peca_id: string
          token: string
          ultimo_acesso?: string | null
        }
        Update: {
          cliente_contato_id?: string
          criado_em?: string
          decidido_em?: string | null
          decisao?: string | null
          expira_em?: string
          handoff_id?: string | null
          id?: string
          peca_id?: string
          token?: string
          ultimo_acesso?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acessos_cliente_cliente_contato_id_fkey"
            columns: ["cliente_contato_id"]
            isOneToOne: false
            referencedRelation: "cliente_contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acessos_cliente_handoff_id_fkey"
            columns: ["handoff_id"]
            isOneToOne: false
            referencedRelation: "handoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acessos_cliente_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
        ]
      }
      autorizacoes_edicao: {
        Row: {
          autorizado_por: string | null
          criado_em: string
          handoff_id: string | null
          id: string
          motivo: string
          peca_id: string
          revogado_em: string | null
          usado: boolean
        }
        Insert: {
          autorizado_por?: string | null
          criado_em?: string
          handoff_id?: string | null
          id?: string
          motivo: string
          peca_id: string
          revogado_em?: string | null
          usado?: boolean
        }
        Update: {
          autorizado_por?: string | null
          criado_em?: string
          handoff_id?: string | null
          id?: string
          motivo?: string
          peca_id?: string
          revogado_em?: string | null
          usado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "autorizacoes_edicao_handoff_id_fkey"
            columns: ["handoff_id"]
            isOneToOne: false
            referencedRelation: "handoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autorizacoes_edicao_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
        ]
      }
      campanhas: {
        Row: {
          arquivada: boolean
          cliente_id: string
          created_at: string
          created_by: string | null
          descricao: string | null
          id: string
          nome: string
        }
        Insert: {
          arquivada?: boolean
          cliente_id: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          nome: string
        }
        Update: {
          arquivada?: boolean
          cliente_id?: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "campanhas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_contatos: {
        Row: {
          cliente_id: string
          created_at: string
          email: string
          id: string
          nome: string
        }
        Insert: {
          cliente_id: string
          created_at?: string
          email: string
          id?: string
          nome: string
        }
        Update: {
          cliente_id?: string
          created_at?: string
          email?: string
          id?: string
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_contatos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          created_at: string
          created_by: string | null
          empresa: string | null
          id: string
          nome: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          empresa?: string | null
          id?: string
          nome: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          empresa?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      comentario_historico: {
        Row: {
          autorizacao_id: string | null
          comentario_id: string
          editado_em: string
          editado_por_cliente_contato_id: string | null
          id: string
          texto_antes: string | null
          texto_depois: string | null
        }
        Insert: {
          autorizacao_id?: string | null
          comentario_id: string
          editado_em?: string
          editado_por_cliente_contato_id?: string | null
          id?: string
          texto_antes?: string | null
          texto_depois?: string | null
        }
        Update: {
          autorizacao_id?: string | null
          comentario_id?: string
          editado_em?: string
          editado_por_cliente_contato_id?: string | null
          id?: string
          texto_antes?: string | null
          texto_depois?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comentario_historico_autorizacao_id_fkey"
            columns: ["autorizacao_id"]
            isOneToOne: false
            referencedRelation: "autorizacoes_edicao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentario_historico_comentario_id_fkey"
            columns: ["comentario_id"]
            isOneToOne: false
            referencedRelation: "comentarios"
            referencedColumns: ["id"]
          },
        ]
      }
      comentarios: {
        Row: {
          anotacao_json: Json | null
          autor_cliente_contato_id: string | null
          autor_papel: Database["public"]["Enums"]["papel_ator"]
          autor_user_id: string | null
          created_at: string
          edicao_autorizada: boolean
          editavel: boolean
          handoff_id: string | null
          id: string
          locked_em: string | null
          peca_id: string
          pin_x: number | null
          pin_y: number | null
          texto: string
          texto_original: string | null
          updated_at: string
          versao_id: string | null
          visivel_para_cliente: boolean
        }
        Insert: {
          anotacao_json?: Json | null
          autor_cliente_contato_id?: string | null
          autor_papel: Database["public"]["Enums"]["papel_ator"]
          autor_user_id?: string | null
          created_at?: string
          edicao_autorizada?: boolean
          editavel?: boolean
          handoff_id?: string | null
          id?: string
          locked_em?: string | null
          peca_id: string
          pin_x?: number | null
          pin_y?: number | null
          texto: string
          texto_original?: string | null
          updated_at?: string
          versao_id?: string | null
          visivel_para_cliente?: boolean
        }
        Update: {
          anotacao_json?: Json | null
          autor_cliente_contato_id?: string | null
          autor_papel?: Database["public"]["Enums"]["papel_ator"]
          autor_user_id?: string | null
          created_at?: string
          edicao_autorizada?: boolean
          editavel?: boolean
          handoff_id?: string | null
          id?: string
          locked_em?: string | null
          peca_id?: string
          pin_x?: number | null
          pin_y?: number | null
          texto?: string
          texto_original?: string | null
          updated_at?: string
          versao_id?: string | null
          visivel_para_cliente?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "comentarios_autor_cliente_contato_id_fkey"
            columns: ["autor_cliente_contato_id"]
            isOneToOne: false
            referencedRelation: "cliente_contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_handoff_id_fkey"
            columns: ["handoff_id"]
            isOneToOne: false
            referencedRelation: "handoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_versao_id_fkey"
            columns: ["versao_id"]
            isOneToOne: false
            referencedRelation: "peca_versoes"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos: {
        Row: {
          ator_nome: string | null
          ator_papel: Database["public"]["Enums"]["papel_ator"] | null
          created_at: string
          detalhe: string | null
          id: string
          peca_id: string
          tipo: Database["public"]["Enums"]["tipo_evento"]
          versao_id: string | null
        }
        Insert: {
          ator_nome?: string | null
          ator_papel?: Database["public"]["Enums"]["papel_ator"] | null
          created_at?: string
          detalhe?: string | null
          id?: string
          peca_id: string
          tipo: Database["public"]["Enums"]["tipo_evento"]
          versao_id?: string | null
        }
        Update: {
          ator_nome?: string | null
          ator_papel?: Database["public"]["Enums"]["papel_ator"] | null
          created_at?: string
          detalhe?: string | null
          id?: string
          peca_id?: string
          tipo?: Database["public"]["Enums"]["tipo_evento"]
          versao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eventos_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
        ]
      }
      handoffs: {
        Row: {
          de_papel: Database["public"]["Enums"]["papel_ator"]
          enviado_em: string
          enviado_por: string | null
          id: string
          para_papel: Database["public"]["Enums"]["papel_ator"]
          peca_id: string
          recolhido_em: string | null
          versao_id: string | null
          visto_em: string | null
          visto_por: string | null
        }
        Insert: {
          de_papel: Database["public"]["Enums"]["papel_ator"]
          enviado_em?: string
          enviado_por?: string | null
          id?: string
          para_papel: Database["public"]["Enums"]["papel_ator"]
          peca_id: string
          recolhido_em?: string | null
          versao_id?: string | null
          visto_em?: string | null
          visto_por?: string | null
        }
        Update: {
          de_papel?: Database["public"]["Enums"]["papel_ator"]
          enviado_em?: string
          enviado_por?: string | null
          id?: string
          para_papel?: Database["public"]["Enums"]["papel_ator"]
          peca_id?: string
          recolhido_em?: string | null
          versao_id?: string | null
          visto_em?: string | null
          visto_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handoffs_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "handoffs_versao_id_fkey"
            columns: ["versao_id"]
            isOneToOne: false
            referencedRelation: "peca_versoes"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          created_at: string
          destinatario_cliente_contato_id: string | null
          destinatario_user_id: string | null
          id: string
          lida: boolean
          mensagem: string | null
          peca_id: string | null
          tipo: Database["public"]["Enums"]["tipo_notificacao"]
          titulo: string
        }
        Insert: {
          created_at?: string
          destinatario_cliente_contato_id?: string | null
          destinatario_user_id?: string | null
          id?: string
          lida?: boolean
          mensagem?: string | null
          peca_id?: string | null
          tipo: Database["public"]["Enums"]["tipo_notificacao"]
          titulo: string
        }
        Update: {
          created_at?: string
          destinatario_cliente_contato_id?: string | null
          destinatario_user_id?: string | null
          id?: string
          lida?: boolean
          mensagem?: string | null
          peca_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_notificacao"]
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
        ]
      }
      peca_versoes: {
        Row: {
          altura_px: number | null
          created_at: string
          enviada_por: string | null
          id: string
          imagem_path: string | null
          imagem_url: string | null
          largura_px: number | null
          nome_snapshot: string | null
          numero: number
          observacao: string | null
          peca_id: string
          tamanho_snapshot: string | null
        }
        Insert: {
          altura_px?: number | null
          created_at?: string
          enviada_por?: string | null
          id?: string
          imagem_path?: string | null
          imagem_url?: string | null
          largura_px?: number | null
          nome_snapshot?: string | null
          numero: number
          observacao?: string | null
          peca_id: string
          tamanho_snapshot?: string | null
        }
        Update: {
          altura_px?: number | null
          created_at?: string
          enviada_por?: string | null
          id?: string
          imagem_path?: string | null
          imagem_url?: string | null
          largura_px?: number | null
          nome_snapshot?: string | null
          numero?: number
          observacao?: string | null
          peca_id?: string
          tamanho_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "peca_versoes_peca_id_fkey"
            columns: ["peca_id"]
            isOneToOne: false
            referencedRelation: "pecas"
            referencedColumns: ["id"]
          },
        ]
      }
      pecas: {
        Row: {
          campanha_id: string
          created_at: string
          created_by: string | null
          id: string
          modo_aprovacao: string
          nome: string
          status: Database["public"]["Enums"]["piece_status"]
          tamanho: string | null
          thumb_url: string | null
          tipo: string | null
          updated_at: string
          versao_atual: number
        }
        Insert: {
          campanha_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          modo_aprovacao?: string
          nome: string
          status?: Database["public"]["Enums"]["piece_status"]
          tamanho?: string | null
          thumb_url?: string | null
          tipo?: string | null
          updated_at?: string
          versao_atual?: number
        }
        Update: {
          campanha_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          modo_aprovacao?: string
          nome?: string
          status?: Database["public"]["Enums"]["piece_status"]
          tamanho?: string | null
          thumb_url?: string | null
          tipo?: string | null
          updated_at?: string
          versao_atual?: number
        }
        Relationships: [
          {
            foreignKeyName: "pecas_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean
          created_at: string
          email: string | null
          id: string
          nome: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          id: string
          nome?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          id?: string
          nome?: string | null
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acesso_por_token: {
        Args: { p_token: string }
        Returns: {
          cliente_contato_id: string
          criado_em: string
          decidido_em: string | null
          decisao: string | null
          expira_em: string
          handoff_id: string | null
          id: string
          peca_id: string
          token: string
          ultimo_acesso: string | null
        }
        SetofOptions: {
          from: "*"
          to: "acessos_cliente"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      autorizar_edicao_cliente: {
        Args: { p_handoff_id: string; p_motivo: string }
        Returns: string
      }
      cliente_abrir: { Args: { p_token: string }; Returns: Json }
      cliente_aprovar: { Args: { p_token: string }; Returns: undefined }
      cliente_comentar: {
        Args: {
          p_anotacao_json?: Json
          p_pin_x?: number
          p_pin_y?: number
          p_texto: string
          p_token: string
        }
        Returns: string
      }
      cliente_devolver: { Args: { p_token: string }; Returns: undefined }
      cliente_editar_comentario: {
        Args: { p_comentario_id: string; p_texto: string; p_token: string }
        Returns: undefined
      }
      cobrar_aprovador: {
        Args: { p_cliente_contato_id: string; p_peca_id: string }
        Returns: undefined
      }
      comentar_interno:
        | {
            Args: {
              p_peca_id: string
              p_pin_x?: number
              p_pin_y?: number
              p_texto: string
              p_visivel_cliente?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              p_anotacao_json?: Json
              p_peca_id: string
              p_pin_x?: number
              p_pin_y?: number
              p_texto: string
              p_visivel_cliente?: boolean
            }
            Returns: string
          }
      editar_peca_meta: {
        Args: { p_nome: string; p_peca_id: string; p_tamanho: string }
        Returns: undefined
      }
      ensure_profile: { Args: { _nome: string }; Returns: undefined }
      enviar_peca: {
        Args: {
          p_contato_ids?: string[]
          p_modo_aprovacao?: string
          p_peca_id: string
        }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_interno: { Args: never; Returns: boolean }
      marcar_visto: { Args: { p_peca_id: string }; Returns: undefined }
      nome_ator: { Args: never; Returns: string }
      papel_atual: {
        Args: never
        Returns: Database["public"]["Enums"]["papel_ator"]
      }
      recolher_envio: { Args: { p_peca_id: string }; Returns: undefined }
      revogar_autorizacao: {
        Args: { p_autorizacao_id: string }
        Returns: undefined
      }
      subir_versao: {
        Args: {
          p_altura?: number
          p_imagem_path: string
          p_imagem_url: string
          p_largura?: number
          p_observacao?: string
          p_peca_id: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "atendimento" | "criacao"
      papel_ator: "criacao" | "atendimento" | "cliente"
      piece_status:
        | "criacao_ajustando"
        | "aguardando_atendimento"
        | "aguardando_cliente"
        | "retorno_atendimento"
        | "aprovada"
        | "arquivada"
      tipo_evento:
        | "subiu_versao"
        | "enviou"
        | "viu"
        | "comentou"
        | "autorizou_edicao"
        | "revogou_autorizacao"
        | "aprovou"
        | "devolveu"
      tipo_notificacao:
        | "pronta_aprovacao"
        | "enviada_cliente"
        | "cliente_devolveu"
        | "enviada_correcao"
        | "aprovada"
        | "edicao_autorizada"
        | "lembrete_aprovacao"
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
      app_role: ["admin", "atendimento", "criacao"],
      papel_ator: ["criacao", "atendimento", "cliente"],
      piece_status: [
        "criacao_ajustando",
        "aguardando_atendimento",
        "aguardando_cliente",
        "retorno_atendimento",
        "aprovada",
        "arquivada",
      ],
      tipo_evento: [
        "subiu_versao",
        "enviou",
        "viu",
        "comentou",
        "autorizou_edicao",
        "revogou_autorizacao",
        "aprovou",
        "devolveu",
      ],
      tipo_notificacao: [
        "pronta_aprovacao",
        "enviada_cliente",
        "cliente_devolveu",
        "enviada_correcao",
        "aprovada",
        "edicao_autorizada",
        "lembrete_aprovacao",
      ],
    },
  },
} as const
