# Auditoria de segurança: clínica, avaliações, especialista e desativação

Escopo: rotas `/clinica`, `/avaliacoes`, `PUT` e `DELETE /especialista/:id` e `DELETE /paciente/:id`.
Os achados foram **reproduzidos** com testes de integração (SQLite em memória, entidades e
controllers reais) em `src/test/integration/`.

## Modelo de acesso depois das correções

| Recurso | Quem acessa | Regra de objeto (BOLA) |
|---|---|---|
| `POST /clinica` | CLINICA autenticada | (cria outra clínica) |
| `GET /clinica`, `/clinica/:id` | público | vitrine sem e-mail, senha ou role |
| `PUT`, `DELETE /clinica/:id` | CLINICA | só a própria (`id` do token = `id` da URL) |
| `POST`, `GET /clinica/:id/especialista` | CLINICA | só a própria; vincula apenas especialista sem clínica |
| `PUT /especialista/:id` | ESPECIALISTA | só o próprio |
| `DELETE /especialista/:id` | ESPECIALISTA ou CLINICA | o próprio, ou a clínica a que pertence; **desativa** |
| `POST /avaliacoes` | PACIENTE | autor = token; só quem foi atendido; 1 por paciente e especialista |
| `DELETE /paciente/:id` | PACIENTE | só o próprio; **desativa** |

## Achados

| # | Severidade | Onde | Problema | Estado |
|---|---|---|---|---|
| 1 | **Crítica** | `POST /clinica` | Sem autenticação: qualquer pessoa criava uma conta `CLINICA`, o perfil mais poderoso (insights, cadastro de médicos). | Corrigido |
| 2 | **Crítica** | `PUT`, `DELETE /clinica/:id` | Sem autenticação: qualquer um alterava o e-mail (login) ou apagava qualquer clínica. | Corrigido |
| 3 | **Crítica** | `POST /clinica/:id/especialista` | Sem autenticação: movia qualquer especialista para qualquer clínica. | Corrigido |
| 4 | **Alta** | `POST /avaliacoes` | Sem autenticação e com `idPaciente` no corpo: avaliações falsas em nome de qualquer paciente. | Corrigido |
| 5 | **Alta** | `GET /avaliacoes`, `GET /especialista` | Devolviam `pacienteId` de cada avaliação (liga paciente a médico, dado de saúde). A entidade `Especialista` carrega as avaliações de forma eager, então vazava também em `/consulta`. | Corrigido |
| 6 | **Alta** | `PUT`, `DELETE /especialista/:id` | Só checavam o perfil: qualquer especialista editava ou apagava outro. | Corrigido |
| 7 | **Alta** | `POST /clinica`, `POST /especialista` | A resposta devolvia a entidade com o **hash da senha** recém-gerado. | Corrigido |
| 8 | Média | entidade `Clinica` | Decorators trocados (`@OneToOne` em `nome`, `@JoinColumn` em `endereco`): o endereço nunca era salvo e `GET`, `PUT`, `DELETE /clinica/:id` davam erro 500. | Corrigido |
| 9 | Média | cadastros | E-mail não era único entre paciente, especialista e clínica, mas o login identifica a conta só pelo e-mail. | Corrigido na aplicação (ver pendência 5) |
| 10 | Média | `GET /avaliacoes` | Sem paginação: devolvia a tabela inteira. | Corrigido (máx. 100 por página) |
| 11 | Média | `DELETE /paciente/:id` | Apagava o registro de verdade (e falha por chave estrangeira com consultas). | Corrigido: desativa |
| 12 | Baixa | `GET /especialista/busca` | Erro 500 para especialista sem endereço. | Corrigido |

## O que "desativar" faz

Paciente e especialista **não são apagados**: o histórico de consultas e avaliações é mantido
(prontuário tem prazo legal de guarda) e a chave estrangeira não quebra. Ao desativar:

- as consultas **futuras** são canceladas logicamente (motivo `paciente_desistiu` ou `médico_cancelou`);
- login e renovação de token passam a responder 403 `Conta desativada!`;
- o access token usado na requisição vai para a blocklist;
- a conta some das listagens públicas;
- repetir a operação é seguro (idempotente).

## Pendências (não corrigidas)

1. **Senhas são cifradas, não hasheadas.** `encryptPassword` usa AES com sal fixo e o login
   *decifra* e compara em texto puro (comparação não constante). Quem obtiver o banco e
   `SECRET_KEY_CRYPTO` lê todas as senhas. Trocar por `scrypt`/`argon2`, com migração no login.
2. **Sem proteção contra força bruta** em `/auth/login` (limite de tentativas, bloqueio).
3. **`errorMiddleware` devolve `error.message`** em erros inesperados, o que expõe detalhes internos.
4. **`POST /especialista` não valida a entrada** (e-mail, senha forte, CRM, telefone). Falta contrato
   como o de paciente e clínica.
5. **Unicidade só na aplicação:** e-mail e "1 avaliação por paciente e especialista" não têm
   restrição no banco, então duas requisições simultâneas ainda podem duplicar.
6. **Janela de 20 minutos:** tokens de acesso já emitidos continuam válidos até expirar depois da
   desativação (só o token usado na requisição é invalidado). Verificar `estaAtivo` a cada
   requisição fecha a janela, ao custo de uma consulta por chamada.
7. **LGPD:** não há anonimização nem política de retenção. Guardar o prontuário é obrigação, mas
   o pedido de exclusão de dados pessoais precisa de decisão jurídica (o que anonimizar, quando).
8. **Clínica enxerga todas as consultas** (`GET /consulta`). Agora que o especialista pertence a
   uma clínica, dá para filtrar por `especialista.clinica`.
9. **CORS:** `origin: false`, métodos `GET`/`POST` e só o header `Content-Type`. Um front em outra
   origem não consegue enviar `Authorization` nem `PUT`/`PATCH`/`DELETE`.
10. **Não auditado:** upload de imagens e `express.static("tmp")`.
11. `historico` usa `simple-array`: um item com vírgula (`"asma,moderada"`) é lido de volta como
    dois itens.
