import logging
from typing import Optional
from .base_provider import BaseProvider

logger = logging.getLogger(__name__)

class CodeT5Provider(BaseProvider):
    def __init__(self, api_key: str = 'local', model: Optional[str] = 'Salesforce/codet5-small', endpoint: Optional[str] = None):
        super().__init__(api_key, model, endpoint)
        self.enabled = False
        self.pipeline = None
        
        try:
            from transformers import pipeline, AutoModelForSeq2SeqLM, AutoTokenizer
            import torch
            
            logger.info(f"Loading local CodeT5 model: {model}...")
            
            # Automatically target optimal hardware
            device = "cpu"
            if torch.backends.mps.is_available():
                device = "mps"
            elif torch.cuda.is_available():
                device = "cuda"
                
            self.tokenizer = AutoTokenizer.from_pretrained(model)
            self.model_inst = AutoModelForSeq2SeqLM.from_pretrained(model).to(device)
            
            self.pipeline = pipeline(
                "text2text-generation", 
                model=self.model_inst, 
                tokenizer=self.tokenizer,
                device=device
            )
            self.enabled = True
            logger.info(f"CodeT5 pipeline initialized successfully on {device} hardware")
        except ImportError:
            logger.error("Hugging Face transformers or PyTorch are missing. Run `pip install transformers torch`")
        except Exception as e:
            logger.error(f"Failed to initialize CodeT5 model {model}: {e}")

    def generate_conversion(self, prompt: str) -> str:
        if not self.enabled or not self.pipeline:
            raise RuntimeError("CodeT5 pipeline was not properly loaded.")
            
        try:
            logger.debug(f"CodeT5 inference started. Prompt len: {len(prompt)}")
            
            # Send prompt through model and enforce generation constraints
            output = self.pipeline(
                prompt,
                max_new_tokens=1024,
                num_return_sequences=1,
                truncation=True
            )
            
            response_text = output[0]['generated_text']
            return response_text
            
        except Exception as e:
            logger.error(f"CodeT5 Model Inference Error: {str(e)}")
            raise e
