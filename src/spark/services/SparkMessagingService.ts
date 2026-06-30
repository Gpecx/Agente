import evolutionApiService from '../../services/EvolutionApiService';

class SparkMessagingService {
  async enviarGrupo(instance: string, groupJid: string, texto: string): Promise<void> {
    await evolutionApiService.sendText(instance, groupJid, texto);
  }

  async enviarGrupoComMencao(
    instance: string,
    groupJid: string,
    texto: string,
    mentionedJid: string
  ): Promise<void> {
    await evolutionApiService.sendTextWithMention(instance, groupJid, texto, mentionedJid);
  }

  async enviarDM(instance: string, jid: string, texto: string): Promise<void> {
    await evolutionApiService.sendText(instance, jid, texto);
  }
}

export default new SparkMessagingService();
